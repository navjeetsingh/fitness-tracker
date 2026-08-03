// pages/api/garmin.js
// Returns cached Garmin health data (sleep, HRV, Body Battery, RHR, stress) — see lib/garmin.js.
import { getGarminData } from '../../lib/garmin'

export default async function handler(req, res) {
  try {
    const data = await getGarminData()
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
