// Strava data is pulled server-side using a long-lived refresh token —
// no per-visitor OAuth button. The refresh token is seeded once via the
// private setup flow in pages/api/auth/strava.js (see storeStravaAuth)
// and rotated automatically on every use (Strava issues a new refresh
// token on each refresh call).
import { redis } from './redis.js'

const REFRESH_TOKEN_KEY = 'strava:refresh_token'
const ACCESS_TOKEN_KEY = 'strava:access_token'
const ATHLETE_KEY = 'strava:athlete'

/**
 * Persists the tokens from the one-time OAuth setup flow (see pages/api/auth/*.js)
 * so the dashboard can pull Strava data server-side without a per-visitor login.
 *
 * @param {{refresh_token: string, access_token: string, expires_at: number, athlete?: object}} auth
 * @returns {Promise<void>}
 */
export async function storeStravaAuth({ refresh_token, access_token, expires_at, athlete }) {
  await redis.set(REFRESH_TOKEN_KEY, refresh_token)
  await redis.set(ACCESS_TOKEN_KEY, { access_token, expires_at })
  if (athlete) await redis.set(ATHLETE_KEY, athlete)
}

/** @returns {Promise<{name: string, avatar: string, id: number}|null>} */
export async function getStravaAthlete() {
  return redis.get(ATHLETE_KEY)
}

/**
 * Returns a valid Strava access token, refreshing it (and rotating the stored
 * refresh token, since Strava issues a new one on every refresh call) if the
 * cached token has expired or doesn't exist yet.
 *
 * @returns {Promise<string|null>} null if Strava has never been connected
 */
export async function getAccessToken() {
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

// Strava's own OAuth "visibility" setting — 'everyone' is the only level that means
// truly public. Older activities may only have the legacy `private` boolean instead
// of `visibility`, so fall back to that.
const isPublic = (a) => (a.visibility ? a.visibility === 'everyone' : a.private === false)

// Shared summary-activity shape between fetchStravaData (rolling 14-day window) and
// getStravaActivitiesInRange (on-demand historical queries) — both hit the same
// SummaryActivity endpoint, just with different after/before bounds.
function formatActivity(a) {
  return {
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
    hasGear: !!a.gear_id,
  }
}

/**
 * Last 14 days of public Strava activities plus derived running stats, sorted
 * newest first.
 *
 * @returns {Promise<{activities: object[], stats: object}|null>} null if Strava
 *   isn't connected yet.
 */
export async function fetchStravaData() {
  const token = await getAccessToken()
  if (!token) return null

  const since = Math.floor(Date.now() / 1000) - 14 * 86400
  const r = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${since}&per_page=30`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const raw = await r.json()
  if (!Array.isArray(raw)) throw new Error('Strava API error')

  const activities = raw
    .filter(isPublic)
    .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))

  const runs = activities.filter(a => a.type === 'Run' || a.sport_type === 'Run')
  const weeklyKm = runs.reduce((s, a) => s + a.distance / 1000, 0)
  const avgHR = runs.filter(a => a.average_heartrate)
    .reduce((s, a, _, arr) => s + a.average_heartrate / arr.length, 0)
  const longestRun = runs.reduce((m, a) => Math.max(m, a.distance / 1000), 0)
  const totalCalories = activities.reduce((s, a) => s + (a.calories || 0), 0)

  return {
    activities: activities.map(formatActivity),
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

/**
 * On-demand historical query for the Discord bot: public Strava activities within an
 * arbitrary date range, beyond the dashboard's rolling 14-day window. Paginates
 * through Strava's SummaryActivity endpoint (100/page) until a short page ends it.
 *
 * @param {string|Date} afterDate - inclusive lower bound
 * @param {string|Date} beforeDate - inclusive upper bound
 * @returns {Promise<object[]|null>} activities sorted newest first; null if Strava
 *   isn't connected yet.
 */
export async function getStravaActivitiesInRange(afterDate, beforeDate) {
  const token = await getAccessToken()
  if (!token) return null

  const after = Math.floor(new Date(afterDate).getTime() / 1000)
  const before = Math.floor(new Date(beforeDate).getTime() / 1000) + 86400 // include the whole end day

  const all = []
  for (let page = 1; ; page++) {
    const r = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${after}&before=${before}&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const raw = await r.json()
    if (!Array.isArray(raw)) throw new Error('Strava API error')
    all.push(...raw)
    if (raw.length < 100) break
  }

  return all
    .filter(isPublic)
    .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
    .map(formatActivity)
}

/**
 * Best-effort activity tags. Strava does have real activity tags (confirmed against
 * a live account — e.g. a walk tagged "WithPet"), but that field isn't exposed
 * through the public OAuth API this app authenticates with, only Strava's own
 * internal clients. As a stand-in, this scans the free-text activity description
 * for #hashtag-style tokens (e.g. "#WithPet").
 *
 * @param {string|null|undefined} description
 * @returns {string[]} unique tag names, without the '#'
 */
function parseTags(description) {
  if (!description) return []
  const matches = description.match(/#(\w+)/g) || []
  return [...new Set(matches.map(t => t.slice(1)))]
}

/**
 * Full detail for a single activity — the dashboard list only has SummaryActivity,
 * which lacks description, full photos, and the route polyline, so this fetches
 * Strava's DetailedActivity plus a photos call.
 *
 * @param {string|number} id - Strava activity ID
 * @returns {Promise<object|null>} null if not found, not accessible, or not public
 *   (never serves non-public activity detail, even to an authenticated request).
 */
export async function getStravaActivityDetail(id) {
  const token = await getAccessToken()
  if (!token) return null

  const [activityRes, photosRes] = await Promise.all([
    fetch(`https://www.strava.com/api/v3/activities/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`https://www.strava.com/api/v3/activities/${id}/photos?size=600`, { headers: { Authorization: `Bearer ${token}` } }),
  ])
  if (!activityRes.ok) return null

  const a = await activityRes.json()
  if (!isPublic(a)) return null // never serve non-public activity detail

  const photos = photosRes.ok ? await photosRes.json() : []
  // Gear (shoe/bike) name + total distance is already embedded in DetailedActivity —
  // no separate /gear/{id} call needed.
  const gear = a.gear ? { name: a.gear.name, distanceKm: a.gear.converted_distance } : null

  return {
    id: a.id,
    name: a.name,
    description: a.description || null,
    tags: parseTags(a.description),
    type: a.sport_type || a.type,
    date: a.start_date_local,
    distance: +(a.distance / 1000).toFixed(2),
    duration: a.moving_time,
    pace: a.moving_time && a.distance ? +(a.moving_time / (a.distance / 1000) / 60).toFixed(2) : null,
    avgHR: a.average_heartrate || null,
    maxHR: a.max_heartrate || null,
    avgWatts: a.average_watts || null,
    elevation: a.total_elevation_gain || 0,
    calories: a.calories || 0,
    prs: a.pr_count || 0,
    gear,
    // summary_polyline can be an empty string on very short activities — fall back
    // to the full-resolution polyline in that case.
    polyline: a.map?.summary_polyline || a.map?.polyline || null,
    photos: (Array.isArray(photos) ? photos : []).map(p => p.urls?.['600'] || p.urls?.['100']).filter(Boolean),
  }
}
