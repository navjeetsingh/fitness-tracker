// pages/api/strava.js
// Returns last 14 days of Strava activities + stats
import { parse } from 'cookie'

async function refreshIfNeeded(accessToken, refreshToken, expiresAt, res) {
  if (Date.now() / 1000 < expiresAt - 60) return accessToken
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await r.json()
  const cookieOpts = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=604800'
  res.setHeader('Set-Cookie', [
    `strava_access_token=${data.access_token}; ${cookieOpts}`,
    `strava_expires_at=${data.expires_at}; ${cookieOpts}`,
  ])
  return data.access_token
}

export default async function handler(req, res) {
  const cookies = parse(req.headers.cookie || '')
  const { strava_access_token, strava_refresh_token, strava_expires_at } = cookies

  if (!strava_access_token) return res.status(401).json({ error: 'not_connected' })

  try {
    const token = await refreshIfNeeded(
      strava_access_token, strava_refresh_token,
      parseInt(strava_expires_at), res
    )

    const since = Math.floor(Date.now() / 1000) - 14 * 86400
    const r = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${since}&per_page=30`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const activities = await r.json()

    // Compute weekly stats
    const runs = activities.filter(a => a.type === 'Run' || a.sport_type === 'Run')
    const weeklyKm = runs.reduce((s, a) => s + a.distance / 1000, 0)
    const avgHR = runs.filter(a => a.average_heartrate)
      .reduce((s, a, _, arr) => s + a.average_heartrate / arr.length, 0)
    const longestRun = runs.reduce((m, a) => Math.max(m, a.distance / 1000), 0)
    const totalCalories = activities.reduce((s, a) => s + (a.calories || 0), 0)

    // Format for dashboard
    const formatted = activities.map(a => ({
      id: a.id,
      name: a.name,
      type: a.sport_type || a.type,
      date: a.start_date_local,
      distance: +(a.distance / 1000).toFixed(2),
      duration: a.moving_time,
      pace: a.moving_time && a.distance ? +(a.moving_time / (a.distance / 1000) / 60).toFixed(2) : null,
      avgHR: a.average_heartrate || null,
      maxHR: a.max_heartrate || null,
      avgWatts: a.average_watts || null,
      elevation: a.total_elevation_gain || 0,
      effort: a.suffer_score || null,
      calories: a.calories || 0,
      kudos: a.kudos_count || 0,
      prs: a.pr_count || 0,
    }))

    res.json({
      activities: formatted,
      stats: {
        weeklyKm: +weeklyKm.toFixed(1),
        avgHR: +avgHR.toFixed(0),
        longestRun: +longestRun.toFixed(1),
        totalCalories,
        runCount: runs.length,
        daysUntilRace: Math.ceil((new Date('2026-12-06') - new Date()) / 86400000),
      }
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
