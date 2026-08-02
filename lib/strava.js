// Strava data is pulled server-side using a long-lived refresh token —
// no per-visitor OAuth button. The refresh token is seeded once via the
// private setup flow in pages/api/auth/strava.js (see storeStravaAuth)
// and rotated automatically on every use (Strava issues a new refresh
// token on each refresh call).
import { redis } from './redis'

const REFRESH_TOKEN_KEY = 'strava:refresh_token'
const ACCESS_TOKEN_KEY = 'strava:access_token'
const ATHLETE_KEY = 'strava:athlete'

export async function storeStravaAuth({ refresh_token, access_token, expires_at, athlete }) {
  await redis.set(REFRESH_TOKEN_KEY, refresh_token)
  await redis.set(ACCESS_TOKEN_KEY, { access_token, expires_at })
  if (athlete) await redis.set(ATHLETE_KEY, athlete)
}

export async function getStravaAthlete() {
  return redis.get(ATHLETE_KEY)
}

async function getAccessToken() {
  const cached = await redis.get(ACCESS_TOKEN_KEY)
  const now = Math.floor(Date.now() / 1000)
  if (cached?.access_token && cached.expires_at > now + 60) return cached.access_token

  const refreshToken = (await redis.get(REFRESH_TOKEN_KEY)) || process.env.STRAVA_REFRESH_TOKEN
  if (!refreshToken) return null

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
  if (!data.access_token) return null

  await redis.set(ACCESS_TOKEN_KEY, { access_token: data.access_token, expires_at: data.expires_at })
  await redis.set(REFRESH_TOKEN_KEY, data.refresh_token)
  return data.access_token
}

export async function fetchStravaData() {
  const token = await getAccessToken()
  if (!token) return null

  const since = Math.floor(Date.now() / 1000) - 14 * 86400
  const r = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${since}&per_page=30`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const activities = await r.json()
  if (!Array.isArray(activities)) throw new Error('Strava API error')

  const runs = activities.filter(a => a.type === 'Run' || a.sport_type === 'Run')
  const weeklyKm = runs.reduce((s, a) => s + a.distance / 1000, 0)
  const avgHR = runs.filter(a => a.average_heartrate)
    .reduce((s, a, _, arr) => s + a.average_heartrate / arr.length, 0)
  const longestRun = runs.reduce((m, a) => Math.max(m, a.distance / 1000), 0)
  const totalCalories = activities.reduce((s, a) => s + (a.calories || 0), 0)

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

  return {
    activities: formatted,
    stats: {
      weeklyKm: +weeklyKm.toFixed(1),
      avgHR: +avgHR.toFixed(0),
      longestRun: +longestRun.toFixed(1),
      totalCalories,
      runCount: runs.length,
      daysUntilRace: Math.ceil((new Date('2026-12-06') - new Date()) / 86400000),
    },
  }
}
