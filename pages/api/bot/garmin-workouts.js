// See garmin-range.js for why this is proxied through Vercel instead of called
// directly from the bot's VM.
import { getGarminUpcomingWorkouts } from '../../../lib/garmin'

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.BOT_API_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const days = req.query.days ? Number(req.query.days) : undefined

  try {
    const data = await getGarminUpcomingWorkouts(days)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
