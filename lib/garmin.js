// Pulls sleep, HRV, Body Battery, RHR, stress, and (on strength-training days) a
// muscle-group breakdown from Garmin Connect, and caches the result in Redis. Garmin
// Connect has no public API — this uses an unofficial, reverse-engineered client, so
// a fresh login on every page view risks the account getting flagged. Every dashboard
// visit reads the cache; only a stale cache triggers a real login (same caching
// approach as lib/strava.js's access token). Activity-detail lookups for muscle
// groups piggyback on this same cache/login instead of triggering their own —
// see getGarminDayFromCache below.
import { redis } from './redis'
import { getMuscleGroupBreakdown } from './muscleGroups'

const SUMMARY_KEY = 'garmin:latest'
const CACHE_TTL = 20 * 60 // 20 minutes
const BANGKOK_UTC_OFFSET = 7 // hours — matches the cron's Asia/Bangkok schedule

// Garmin's per-day stress detail (undocumented, same reasoning as the exercise-sets
// endpoint in lib/muscleGroups.js) returns ~3-minute readings for the whole day.
// We bucket those into hourly averages — negative values mean "not measured" (e.g.
// device off-wrist) and are excluded.
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

async function pullGarminData() {
  const { GarminConnect } = await import('garmin-connect')

  const email = process.env.GARMIN_EMAIL
  const password = process.env.GARMIN_PASSWORD
  if (!email || !password) throw new Error('Garmin credentials not configured')

  const gc = new GarminConnect({ username: email, password })
  await gc.login(email, password)

  const today = new Date()
  const fmt = (d) => d.toISOString().split('T')[0]

  // One batch covers the whole 7-day window instead of a per-day activities call.
  const recentActivities = await gc.getActivities(0, 30).catch(() => [])
  const strengthByDate = {}
  for (const act of recentActivities) {
    if (act.activityType?.typeKey !== 'strength_training') continue
    const dateStr = act.startTimeLocal?.split(' ')[0]
    if (dateStr && !strengthByDate[dateStr]) strengthByDate[dateStr] = act
  }

  // Pull last 7 days of health data
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = fmt(d)

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

      days.push({
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
      })
    } catch {
      days.push({ date: dateStr, error: true })
    }
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

export async function getGarminData() {
  const cached = await redis.get(SUMMARY_KEY)
  if (cached) return cached

  const data = await pullGarminData()
  await redis.set(SUMMARY_KEY, data, { ex: CACHE_TTL })
  return data
}

// Cache-only — looks up a single date within the already-cached 7-day window.
// Never triggers a fresh Garmin login on its own; an activity older than the cached
// window just comes back null rather than logging in again per click (same reasoning
// as getStoredYazioDay in lib/yazio.js).
export async function getGarminDayFromCache(dateStr) {
  const cached = await redis.get(SUMMARY_KEY)
  return cached?.week?.find(d => d.date === dateStr) || null
}
