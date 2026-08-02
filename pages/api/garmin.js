// pages/api/garmin.js
// Pulls sleep, HRV, Body Battery, RHR, stress from Garmin Connect
// Uses garmin-connect npm package (same data source as our Claude chats)

export default async function handler(req, res) {
  // Dynamically import to avoid SSR issues
  const { GarminConnect } = await import('garmin-connect')

  const email = process.env.GARMIN_EMAIL
  const password = process.env.GARMIN_PASSWORD

  if (!email || !password) {
    return res.status(500).json({ error: 'Garmin credentials not configured' })
  }

  try {
    const gc = new GarminConnect({ username: email, password })
    await gc.login(email, password)

    const today = new Date()
    const fmt = (d) => d.toISOString().split('T')[0]

    // Pull last 7 days of health data
    const days = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = fmt(d)

      try {
        const [sleep, stats, hrv] = await Promise.allSettled([
          gc.getSleepData(dateStr),
          gc.getDailyStats(dateStr),
          gc.getHrvData(dateStr),
        ])

        const sleepData = sleep.status === 'fulfilled' ? sleep.value : null
        const statsData = stats.status === 'fulfilled' ? stats.value : null
        const hrvData   = hrv.status  === 'fulfilled' ? hrv.value  : null

        days.push({
          date: dateStr,
          sleep: sleepData ? {
            hours: +((sleepData.dailySleepDTO?.sleepTimeSeconds || 0) / 3600).toFixed(2),
            score: sleepData.dailySleepDTO?.sleepScores?.overall?.value || null,
            deep:  Math.round((sleepData.dailySleepDTO?.deepSleepSeconds || 0) / 60),
            rem:   Math.round((sleepData.dailySleepDTO?.remSleepSeconds  || 0) / 60),
            overnightHRV: sleepData.dailySleepDTO?.avgOvernightHrv || null,
          } : null,
          bodyBattery: statsData ? {
            highest: statsData.bodyBatteryHighestValue || null,
            lowest:  statsData.bodyBatteryLowestValue  || null,
            current: statsData.bodyBatteryMostRecentValue || null,
          } : null,
          rhr:    statsData?.restingHeartRate || null,
          stress: statsData?.averageStressLevel || null,
          steps:  statsData?.totalSteps || null,
          hrv5min: hrvData?.hrvSummary?.lastNight5MinHigh || null,
          hrvAvg:  hrvData?.hrvSummary?.lastNightAvg || null,
        })
      } catch {
        days.push({ date: dateStr, error: true })
      }
    }

    const today_data = days[days.length - 1]
    const avg7dHRV = days
      .filter(d => d.hrvAvg)
      .reduce((s, d, _, a) => s + d.hrvAvg / a.length, 0)

    res.json({
      today: today_data,
      week:  days,
      summary: {
        avg7dHRV: +avg7dHRV.toFixed(0),
        avgSleep: +(days.filter(d => d.sleep?.hours).reduce((s, d, _, a) => s + d.sleep.hours / a.length, 0)).toFixed(1),
        currentRHR: today_data?.rhr || null,
        currentBodyBattery: today_data?.bodyBattery?.current || null,
      }
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
