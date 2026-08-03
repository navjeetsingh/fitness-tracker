// pages/api/activity/[id].js
// Full detail for a single Strava activity: description/tags/photos/gear/route from
// Strava, plus that same calendar day's Garmin health data (incl. muscle-group
// breakdown for strength days) and Yazio nutrition — both cache-only, see
// getGarminDayFromCache / getStoredYazioDay for why we don't trigger fresh logins here.
import { getStravaActivityDetail } from '../../../lib/strava'
import { getGarminDayFromCache } from '../../../lib/garmin'
import { getStoredYazioDay } from '../../../lib/yazio'

export default async function handler(req, res) {
  const { id } = req.query

  try {
    const activity = await getStravaActivityDetail(id)
    if (!activity) return res.status(404).json({ error: 'not_found' })

    const dateStr = activity.date.split('T')[0]
    const [garmin, yazio] = await Promise.all([
      getGarminDayFromCache(dateStr),
      getStoredYazioDay(dateStr),
    ])

    res.json({ activity, day: { garmin, yazio } })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
