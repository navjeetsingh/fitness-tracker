// pages/api/strava.js
// Returns last 14 days of Strava activities + stats, pulled server-side.
// See lib/strava.js — no per-visitor OAuth involved.
import { fetchStravaData, getStravaAthlete } from '../../lib/strava'

export default async function handler(req, res) {
  try {
    const data = await fetchStravaData()
    if (!data) {
      return res.json({ pending: true, message: 'Strava not connected yet.' })
    }
    const athlete = await getStravaAthlete()
    res.json({ ...data, athlete })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
