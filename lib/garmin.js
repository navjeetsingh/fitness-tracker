// Pulls sleep, HRV, Body Battery, RHR, stress, and (on strength-training days) a
// muscle-group breakdown from Garmin Connect, and caches the result in Redis. Garmin
// Connect has no public API — this uses an unofficial, reverse-engineered client, so
// a fresh password login risks the account getting flagged. Every dashboard visit
// reads the data cache; only a stale cache triggers a real Garmin call, and even then
// loginGarmin() prefers restoring a saved OAuth session over a password login (same
// caching approach as lib/strava.js's access token). Activity-detail lookups for
// muscle groups piggyback on this same cache/login instead of triggering their own —
// see getGarminDayFromCache below.
import { redis } from './redis.js'
import { getMuscleGroupBreakdown } from './muscleGroups.js'
import { enumerateDates } from './dateRange.js'
import { getStravaActivitiesInRange } from './strava.js'

const SUMMARY_KEY = 'garmin:latest'
const CACHE_TTL = 20 * 60 // 20 minutes
const HISTORICAL_DAY_KEY_TTL = 365 * 24 * 60 * 60 // 1 year — a past day's data never changes
const BANGKOK_UTC_OFFSET = 7 // hours — matches the cron's Asia/Bangkok schedule
const historicalDayKey = (dateStr) => `garmin:day:${dateStr}`

const SESSION_KEY = 'garmin:session'
// Oauth1 tokens are long-lived (the underlying client auto-refreshes the short-lived
// oauth2 access token off of it — see loginGarmin), but there's no documented hard
// expiry, so this is a safety margin, not a real limit: worst case a stale key just
// falls back to a full login and re-caches, same cost as today's every-call login.
const SESSION_TTL = 30 * 24 * 60 * 60 // 30 days

/**
 * Buckets Garmin's per-day stress detail (undocumented endpoint, same reasoning as
 * the exercise-sets endpoint in lib/muscleGroups.js — ~3-minute readings for the
 * whole day) into hourly averages. Negative values mean "not measured" (e.g. device
 * off-wrist) and are excluded from the average.
 *
 * @param {Array<[number, number]>} stressValuesArray - [epochMs, stressLevel] pairs
 * @returns {Array<{hour: number, value: number|null}>|null} 24 entries (hour 0-23),
 *   or null if no usable readings exist for the day.
 */
function aggregateHourlyStress(stressValuesArray) {
  if (!Array.isArray(stressValuesArray) || !stressValuesArray.length) return null
  const buckets = Array.from({ length: 24 }, () => [])
  for (const [epochMs, value] of stressValuesArray) {
    if (typeof value !== 'number' || value < 0) continue
    const hour = (new Date(epochMs).getUTCHours() + BANGKOK_UTC_OFFSET) % 24
    buckets[hour].push(value)
  }
  const hourly = buckets.map((values, hour) => ({
    hour,
    value: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null,
  }))
  return hourly.some(h => h.value !== null) ? hourly : null
}

// Builds a dateStr -> activity lookup for same-day muscle-group attribution, from a
// batch of recent activities (avoids a per-day activities call).
function buildStrengthByDate(activities) {
  const strengthByDate = {}
  for (const act of activities) {
    if (act.activityType?.typeKey !== 'strength_training') continue
    const dateStr = act.startTimeLocal?.split(' ')[0]
    if (dateStr && !strengthByDate[dateStr]) strengthByDate[dateStr] = act
  }
  return strengthByDate
}

// Body Battery isn't wrapped by the npm package as a named method, so this hits the
// same undocumented endpoint python-garminconnect wraps as get_body_battery
// (wellness-service, startDate/endDate range — one day here). Each entry in
// bodyBatteryValuesArray is [epochMs, level] (confirmed against the response's own
// bodyBatteryValueDescriptorDTOList); negative/missing levels mean "not measured"
// (device off-wrist), same convention as dailyStress's stressValuesArray above.
function extractBodyBattery(report) {
  if (!report || !Array.isArray(report.bodyBatteryValuesArray)) return null
  const levels = report.bodyBatteryValuesArray.map(entry => entry?.[1]).filter(v => typeof v === 'number' && v >= 0)
  if (!levels.length) return null
  return {
    highest: Math.max(...levels),
    lowest: Math.min(...levels),
    current: levels[levels.length - 1],
    charged: report.charged ?? null,
    drained: report.drained ?? null,
  }
}

// Fetches sleep/HRV/Body Battery/RHR/stress/muscle-groups for a single day. Shared by
// the rolling 7-day pull (pullGarminData) and on-demand historical range queries
// (getGarminHistoricalRange) — both need the same per-day shape, just different date
// windows and caching lifetimes.
async function fetchGarminDay(gc, dateStr, strengthByDate) {
  const d = new Date(dateStr + 'T00:00:00Z')
  try {
    const [sleep, heartRate, steps, stressDetail, bodyBatteryDetail] = await Promise.allSettled([
      gc.getSleepData(d),
      gc.getHeartRate(d),
      gc.getSteps(d),
      gc.get(`${gc.url.GC_API}/wellness-service/wellness/dailyStress/${dateStr}`),
      gc.get(`${gc.url.GC_API}/wellness-service/wellness/bodyBattery/reports/daily`, { params: { startDate: dateStr, endDate: dateStr } }),
    ])

    const sleepData  = sleep.status === 'fulfilled' ? sleep.value : null
    const hrData      = heartRate.status === 'fulfilled' ? heartRate.value : null
    const stepsData   = steps.status === 'fulfilled' ? steps.value : null
    const stressData  = stressDetail.status === 'fulfilled' ? stressDetail.value : null
    const bodyBatteryRaw = bodyBatteryDetail.status === 'fulfilled' ? bodyBatteryDetail.value : null
    const bodyBatteryReport = Array.isArray(bodyBatteryRaw) ? bodyBatteryRaw[0] : bodyBatteryRaw

    // Prefer the real all-day Body Battery report; fall back to the overnight-only
    // approximation from sleep readings if the endpoint fails or a day has no report.
    const bbReadings = sleepData?.sleepBodyBattery?.map(r => r.value) || []
    const bodyBattery = extractBodyBattery(bodyBatteryReport) || (bbReadings.length ? {
      highest: Math.max(...bbReadings),
      lowest: Math.min(...bbReadings),
      current: bbReadings[bbReadings.length - 1],
    } : null)

    const strengthActivity = strengthByDate[dateStr]
    const muscleGroups = strengthActivity
      ? await getMuscleGroupBreakdown(gc, strengthActivity.activityId)
      : null

    return {
      date: dateStr,
      sleep: sleepData ? {
        hours: +((sleepData.dailySleepDTO?.sleepTimeSeconds || 0) / 3600).toFixed(2),
        score: sleepData.dailySleepDTO?.sleepScores?.overall?.value || null,
        deep:  Math.round((sleepData.dailySleepDTO?.deepSleepSeconds || 0) / 60),
        rem:   Math.round((sleepData.dailySleepDTO?.remSleepSeconds  || 0) / 60),
        overnightHRV: sleepData.avgOvernightHrv || null,
      } : null,
      bodyBattery,
      rhr:    hrData?.restingHeartRate || sleepData?.restingHeartRate || null,
      stress: stressData?.avgStressLevel ?? sleepData?.dailySleepDTO?.avgSleepStress ?? null,
      stressHourly: aggregateHourlyStress(stressData?.stressValuesArray),
      steps:  typeof stepsData === 'number' ? stepsData : null,
      hrv5min: null, // not exposed by this library
      hrvAvg:  sleepData?.avgOvernightHrv || null,
      muscleGroups,
    }
  } catch {
    return { date: dateStr, error: true }
  }
}

// garmin-connect is CommonJS, and how its interop surfaces the `GarminConnect` class
// through `import()` varies by runtime — confirmed three different shapes: Node 24
// (named export `GarminConnect` present), Node 22 (only `default.GarminConnect`), and
// Vercel's webpack-bundled functions (`default` itself undefined, named export
// present again). Check every observed shape rather than assuming one.
async function resolveGarminConnect() {
  const mod = await import('garmin-connect')
  const ctor = mod.GarminConnect || mod.default?.GarminConnect || mod.default
  if (typeof ctor !== 'function') throw new Error('Could not resolve GarminConnect constructor from garmin-connect module')
  return ctor
}

// Restores a saved OAuth session instead of logging in with the password whenever
// possible. Garmin's anti-bot system flags repeated password logins far more readily
// than a client that periodically refreshes its access token like a real app does —
// this is the same session-reuse mechanism the npm package's own README documents
// (loadToken/exportToken, itself modeled on garth), just wired up to Redis instead of
// a local file so it works from both Vercel and the bot's VM.
async function loginGarmin() {
  const GarminConnect = await resolveGarminConnect()
  const email = process.env.GARMIN_EMAIL
  const password = process.env.GARMIN_PASSWORD
  if (!email || !password) throw new Error('Garmin credentials not configured')

  const gc = new GarminConnect({ username: email, password })
  const savedTokens = await redis.get(SESSION_KEY)

  if (savedTokens?.oauth1 && savedTokens?.oauth2) {
    try {
      gc.loadToken(savedTokens.oauth1, savedTokens.oauth2)
      await gc.getUserProfile() // cheap call to confirm the restored session works (and lets the client silently refresh an expired access token)
      await redis.set(SESSION_KEY, gc.exportToken(), { ex: SESSION_TTL })
      return gc
    } catch (err) {
      console.error('Garmin session restore failed, falling back to full login:', err?.response?.status, err?.message || err)
    }
  }

  await gc.login(email, password)
  await redis.set(SESSION_KEY, gc.exportToken(), { ex: SESSION_TTL })
  return gc
}

// Garmin's personal-record-service groups every PR (across all sports) under one flat
// `typeId` enum with no documented key — these mappings were confirmed by cross-
// referencing each PR's `value` (plausible pace/distance) and, for marathon, its
// absence (typeId 6 never appears for an account with no marathon PR yet).
const RUN_TIME_PR_TYPE_IDS = { fastest1K: 1, fastest5K: 3, fastest10K: 4, fastestHalfMarathon: 5, fastestMarathon: 6 }
const RECORD_DISTANCES_KM = { fastest1K: 1, fastest5K: 5, fastest10K: 10, fastestHalfMarathon: 21.0975, fastestMarathon: 42.195 }
const LONGEST_RUN_TYPE_ID = 7

function formatDuration(totalSeconds) {
  if (totalSeconds == null) return null
  const s = Math.round(totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

// Personal records are keyed by Garmin activity ID, but the dashboard's existing
// activity-detail modal only knows Strava IDs — so find that same day's Strava
// counterpart (single-day lookup, cheap) to make each record clickable.
async function matchStravaActivity(dateStr, distanceKm) {
  try {
    const activities = await getStravaActivitiesInRange(dateStr, dateStr)
    if (!activities?.length) return null
    const tol = Math.max(0.3, distanceKm * 0.1)
    return activities.find(a => Math.abs(a.distance - distanceKm) <= tol)?.id || null
  } catch {
    return null
  }
}

// Fetches VO2 max, fitness age (vs. chronological age), personal records (longest
// run + fastest 1K/5K/10K/half/full), and earned badges — all undocumented endpoints
// (same reasoning as lib/muscleGroups.js), piggybacked on the same login session as
// the rest of pullGarminData rather than triggering a separate one.
async function fetchGarminRecords(gc) {
  const today = new Date().toISOString().split('T')[0]
  const [vo2Res, fitnessAgeRes, profileRes] = await Promise.allSettled([
    gc.get(`${gc.url.GC_API}/metrics-service/metrics/maxmet/latest/${today}`),
    gc.get(`${gc.url.GC_API}/fitnessage-service/fitnessage/${today}`),
    gc.getUserProfile(),
  ])

  const vo2max = vo2Res.status === 'fulfilled' ? vo2Res.value?.generic?.vo2MaxValue ?? null : null
  const fitnessAgeData = fitnessAgeRes.status === 'fulfilled' ? fitnessAgeRes.value : null
  const displayName = profileRes.status === 'fulfilled' ? (profileRes.value?.displayName || profileRes.value?.userName) : null

  let prsRaw = []
  let badgesRaw = []
  if (displayName) {
    const [prsRes, badgesRes] = await Promise.allSettled([
      gc.get(`${gc.url.GC_API}/personalrecord-service/personalrecord/prs/${displayName}`),
      gc.get(`${gc.url.GC_API}/badge-service/badge/earned`),
    ])
    prsRaw = prsRes.status === 'fulfilled' && Array.isArray(prsRes.value) ? prsRes.value : []
    badgesRaw = badgesRes.status === 'fulfilled' && Array.isArray(badgesRes.value) ? badgesRes.value : []
  }
  const byType = Object.fromEntries(prsRaw.map(pr => [pr.typeId, pr]))

  const longestRunPr = byType[LONGEST_RUN_TYPE_ID]
  const longestRun = longestRunPr ? {
    distanceKm: +(longestRunPr.value / 1000).toFixed(2),
    date: longestRunPr.activityStartDateTimeLocalFormatted?.split('T')[0] || null,
    garminActivityId: longestRunPr.activityId || null,
    name: longestRunPr.activityName || null,
  } : null

  const paceRecords = {}
  for (const [key, typeId] of Object.entries(RUN_TIME_PR_TYPE_IDS)) {
    const pr = byType[typeId]
    if (!pr) { paceRecords[key] = null; continue }
    const distanceKm = RECORD_DISTANCES_KM[key]
    paceRecords[key] = {
      seconds: pr.value,
      time: formatDuration(pr.value),
      pace: `${formatDuration(pr.value / distanceKm)}/km`,
      date: pr.activityStartDateTimeLocalFormatted?.split('T')[0] || null,
      garminActivityId: pr.activityId || null,
      name: pr.activityName || null,
    }
  }

  // Cheap single-day Strava lookups, only for records that actually exist.
  const matchable = [['longestRun', longestRun, longestRun?.distanceKm], ...Object.entries(paceRecords).map(([k, v]) => [k, v, RECORD_DISTANCES_KM[k]])]
  for (const [, rec, distanceKm] of matchable) {
    if (rec?.date) rec.stravaActivityId = await matchStravaActivity(rec.date, distanceKm)
  }

  const badges = badgesRaw
    .map(b => ({ id: b.badgeId, name: b.badgeName, points: b.badgePoints || 0, earnedDate: b.badgeEarnedDate }))
    .filter(b => b.earnedDate)
    .sort((a, b) => new Date(b.earnedDate) - new Date(a.earnedDate))

  return {
    vo2max,
    fitnessAge: fitnessAgeData?.fitnessAge != null ? {
      chronological: fitnessAgeData.chronologicalAge,
      fitness: +fitnessAgeData.fitnessAge.toFixed(1),
    } : null,
    longestRun,
    ...paceRecords,
    badges,
  }
}

async function pullGarminData() {
  const gc = await loginGarmin()
  const fmt = (d) => d.toISOString().split('T')[0]
  const today = new Date()

  // One batch covers the whole 7-day window instead of a per-day activities call.
  const recentActivities = await gc.getActivities(0, 30).catch(() => [])
  const strengthByDate = buildStrengthByDate(recentActivities)

  // Pull last 7 days of health data
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    days.push(await fetchGarminDay(gc, fmt(d), strengthByDate))
  }

  const today_data = days[days.length - 1]
  const avg7dHRV = days
    .filter(d => d.hrvAvg)
    .reduce((s, d, _, a) => s + d.hrvAvg / a.length, 0)

  const records = await fetchGarminRecords(gc).catch(() => null)

  return {
    today: today_data,
    week: days,
    summary: {
      avg7dHRV: +avg7dHRV.toFixed(0),
      avgSleep: +(days.filter(d => d.sleep?.hours).reduce((s, d, _, a) => s + d.sleep.hours / a.length, 0)).toFixed(1),
      currentRHR: today_data?.rhr || null,
      currentBodyBattery: today_data?.bodyBattery?.current || null,
    },
    records,
  }
}

/**
 * Returns the last 7 days of Garmin health data (sleep, HRV, Body Battery, RHR,
 * stress, muscle groups) plus VO2 max, fitness age, personal records, and earned
 * badges (see fetchGarminRecords) — all served from one 20-minute Redis cache. Only
 * a stale cache triggers a real Garmin login.
 *
 * @returns {Promise<{today: object, week: object[], summary: object, records: object|null}>}
 */
export async function getGarminData() {
  const cached = await redis.get(SUMMARY_KEY)
  if (cached) return cached

  const data = await pullGarminData()
  await redis.set(SUMMARY_KEY, data, { ex: CACHE_TTL })
  return data
}

/**
 * Looks up a single date within the already-cached 7-day window. Cache-only — never
 * triggers a fresh Garmin login; a date outside the cached window just comes back
 * null rather than logging in again per click (same reasoning as getStoredYazioDay
 * in lib/yazio.js).
 *
 * @param {string} dateStr - date in YYYY-MM-DD format
 * @returns {Promise<object|null>}
 */
export async function getGarminDayFromCache(dateStr) {
  const cached = await redis.get(SUMMARY_KEY)
  return cached?.week?.find(d => d.date === dateStr) || null
}

/**
 * On-demand historical query for the Discord bot: fetches sleep/HRV/Body
 * Battery/RHR/stress/muscle-groups for an arbitrary date range, beyond the dashboard's
 * rolling 7-day cache. Each day is cached permanently once fetched (past days don't
 * change), so a repeated question about the same range only logs in for genuinely new
 * days. Unlike getGarminDayFromCache, this WILL trigger a live Garmin login when
 * needed — acceptable here since it's gated behind the bot's owner-only DM check,
 * not a public endpoint.
 *
 * @param {string} startDateStr - YYYY-MM-DD, inclusive
 * @param {string} endDateStr - YYYY-MM-DD, inclusive
 * @returns {Promise<object[]>} one entry per date, oldest first
 */
export async function getGarminHistoricalRange(startDateStr, endDateStr) {
  const dates = enumerateDates(startDateStr, endDateStr)
  const cached = await Promise.all(dates.map(d => redis.get(historicalDayKey(d))))
  const missingDates = dates.filter((_, i) => !cached[i])
  if (!missingDates.length) return cached

  const gc = await loginGarmin()
  // Wide window so a same-day strength activity is still found for muscle-group
  // attribution even when the range reaches back many months.
  const recentActivities = await gc.getActivities(0, 200).catch(() => [])
  const strengthByDate = buildStrengthByDate(recentActivities)

  const fetchedByDate = {}
  for (const dateStr of missingDates) {
    const day = await fetchGarminDay(gc, dateStr, strengthByDate)
    if (!day.error) await redis.set(historicalDayKey(dateStr), day, { ex: HISTORICAL_DAY_KEY_TTL })
    fetchedByDate[dateStr] = day
  }

  return dates.map((d, i) => cached[i] || fetchedByDate[d])
}

const WORKOUT_CACHE_TTL = 60 * 60 // 1 hour — the plan can change, but not that often
const WORKOUT_DETAIL_TTL = 365 * 24 * 60 * 60 // 1 year — a workout's own structure doesn't change once created
const upcomingWorkoutsKey = (days) => `garmin:workouts:upcoming:${days}`
const workoutDetailKey = (id) => `garmin:workout:${id}`

/**
 * Scheduled Runna sessions (and any calendar race events) for the next N days, pulled
 * from Garmin's training calendar — Runna pushes its plan into Garmin Connect, so this
 * needs no separate Runna integration. Deliberately just titles/dates/type: the coach
 * persona (see fitness-bot's CLAUDE.md) is meant to analyze how the athlete responded
 * to the Runna plan, not regenerate it, so this is "what's scheduled", not a plan.
 *
 * @param {number} [days] - how many days ahead to look, default 14
 * @returns {Promise<Array<{type: 'workout'|'event', title: string, date: string, workoutId: number|null}>>}
 */
export async function getGarminUpcomingWorkouts(days = 14) {
  const cacheKey = upcomingWorkoutsKey(days)
  const cached = await redis.get(cacheKey)
  if (cached) return cached

  const gc = await loginGarmin()
  const today = new Date()
  const endDate = new Date(today)
  endDate.setDate(endDate.getDate() + days)
  const todayStr = today.toISOString().split('T')[0]
  const endStr = endDate.toISOString().split('T')[0]

  const months = new Set()
  for (let d = new Date(today); d <= endDate; d.setDate(d.getDate() + 1)) {
    months.add(`${d.getFullYear()}-${d.getMonth()}`) // Garmin's calendar-service uses 0-indexed months, like JS Date
  }

  const items = []
  for (const key of months) {
    const [year, month] = key.split('-').map(Number)
    const cal = await gc.get(`${gc.url.GC_API}/calendar-service/year/${year}/month/${month}`).catch(() => null)
    if (cal?.calendarItems) items.push(...cal.calendarItems)
  }

  const upcoming = items
    .filter(i => (i.itemType === 'workout' || i.itemType === 'event') && i.date >= todayStr && i.date <= endStr)
    // The calendar item's own `id` is the *schedule entry*, not the workout definition —
    // getGarminWorkoutDetail needs the separate `workoutId` field.
    .map(i => ({ type: i.itemType, title: i.title, date: i.date, workoutId: i.itemType === 'workout' ? i.workoutId : null }))
    .sort((a, b) => a.date.localeCompare(b.date))

  await redis.set(cacheKey, upcoming, { ex: WORKOUT_CACHE_TTL })
  return upcoming
}

/**
 * Full structure of one planned workout — target paces/HR zones per step, not just
 * its name. Use after getGarminUpcomingWorkouts surfaces a workoutId, to see exactly
 * what a session is asking for (e.g. "10km at a conversational pace" vs. specific
 * interval targets) before comparing it against what was actually run.
 *
 * @param {number|string} workoutId
 * @returns {Promise<{workoutId, name, description, provider, sportType, estimatedDistanceKm, steps: Array}>}
 */
export async function getGarminWorkoutDetail(workoutId) {
  const cacheKey = workoutDetailKey(workoutId)
  const cached = await redis.get(cacheKey)
  if (cached) return cached

  const gc = await loginGarmin()
  const detail = await gc.getWorkoutDetail({ workoutId: String(workoutId) })

  const steps = (detail.workoutSegments || []).flatMap(seg => seg.workoutSteps || []).map(s => ({
    description: s.description,
    endCondition: s.endCondition?.conditionTypeKey || null,
    endConditionValue: s.endConditionValue ?? null,
    targetType: s.targetType?.workoutTargetTypeKey || null,
    targetLow: s.targetValueOne ?? null,
    targetHigh: s.targetValueTwo ?? null,
  }))

  const simplified = {
    workoutId: detail.workoutId,
    name: detail.workoutName,
    description: detail.description,
    provider: detail.workoutProvider,
    sportType: detail.sportType?.sportTypeKey || null,
    estimatedDistanceKm: detail.estimatedDistanceInMeters ? detail.estimatedDistanceInMeters / 1000 : null,
    steps,
  }

  await redis.set(cacheKey, simplified, { ex: WORKOUT_DETAIL_TTL })
  return simplified
}
