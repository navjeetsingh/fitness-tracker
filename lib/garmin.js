// Pulls sleep, HRV, Body Battery, RHR, stress, and (on strength-training days) a
// muscle-group breakdown from Garmin Connect, and caches the result in Redis. Garmin
// Connect has no public API — this uses an unofficial, reverse-engineered client, so
// a fresh login on every page view risks the account getting flagged. Every dashboard
// visit reads the cache; only a stale cache triggers a real login (same caching
// approach as lib/strava.js's access token). Activity-detail lookups for muscle
// groups piggyback on this same cache/login instead of triggering their own —
// see getGarminDayFromCache below.
import { redis } from './redis.js'
import { getMuscleGroupBreakdown } from './muscleGroups.js'
import { enumerateDates } from './dateRange.js'

const SUMMARY_KEY = 'garmin:latest'
const CACHE_TTL = 20 * 60 // 20 minutes
const HISTORICAL_DAY_KEY_TTL = 365 * 24 * 60 * 60 // 1 year — a past day's data never changes
const BANGKOK_UTC_OFFSET = 7 // hours — matches the cron's Asia/Bangkok schedule
const historicalDayKey = (dateStr) => `garmin:day:${dateStr}`

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

// Fetches sleep/HRV/Body Battery/RHR/stress/muscle-groups for a single day. Shared by
// the rolling 7-day pull (pullGarminData) and on-demand historical range queries
// (getGarminHistoricalRange) — both need the same per-day shape, just different date
// windows and caching lifetimes.
async function fetchGarminDay(gc, dateStr, strengthByDate) {
  const d = new Date(dateStr + 'T00:00:00Z')
  try {
    const [sleep, heartRate, steps, stressDetail] = await Promise.allSettled([
      gc.getSleepData(d),
      gc.getHeartRate(d),
      gc.getSteps(d),
      gc.get(`${gc.url.GC_API}/wellness-service/wellness/dailyStress/${dateStr}`),
    ])

    const sleepData  = sleep.status === 'fulfilled' ? sleep.value : null
    const hrData      = heartRate.status === 'fulfilled' ? heartRate.value : null
    const stepsData   = steps.status === 'fulfilled' ? steps.value : null
    const stressData  = stressDetail.status === 'fulfilled' ? stressDetail.value : null

    // Body Battery isn't exposed as a daily summary by this library —
    // approximate highest/lowest/current from the overnight readings.
    const bbReadings = sleepData?.sleepBodyBattery?.map(r => r.value) || []

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
      bodyBattery: bbReadings.length ? {
        highest: Math.max(...bbReadings),
        lowest:  Math.min(...bbReadings),
        current: bbReadings[bbReadings.length - 1],
      } : null,
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

function loginGarmin() {
  // Destructuring the named export here is fragile: garmin-connect is CommonJS, and
  // whether Node's CJS->ESM interop surfaces a `GarminConnect` named export (vs. only
  // `default`) depends on the Node version's cjs-module-lexer — confirmed to differ
  // between Node 24 (named export present) and Node 22 (named export absent, only
  // `default.GarminConnect`). `.default.GarminConnect` is present on both.
  return import('garmin-connect').then(async (mod) => {
    const GarminConnect = mod.default.GarminConnect
    const email = process.env.GARMIN_EMAIL
    const password = process.env.GARMIN_PASSWORD
    if (!email || !password) throw new Error('Garmin credentials not configured')

    const gc = new GarminConnect({ username: email, password })
    await gc.login(email, password)
    return gc
  })
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

  return {
    today: today_data,
    week: days,
    summary: {
      avg7dHRV: +avg7dHRV.toFixed(0),
      avgSleep: +(days.filter(d => d.sleep?.hours).reduce((s, d, _, a) => s + d.sleep.hours / a.length, 0)).toFixed(1),
      currentRHR: today_data?.rhr || null,
      currentBodyBattery: today_data?.bodyBattery?.current || null,
    },
  }
}

/**
 * Returns the last 7 days of Garmin health data (sleep, HRV, Body Battery, RHR,
 * stress, muscle groups), served from a 20-minute Redis cache. Only a stale cache
 * triggers a real Garmin login.
 *
 * @returns {Promise<{today: object, week: object[], summary: object}>}
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
