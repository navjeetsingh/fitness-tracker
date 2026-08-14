// See garmin-range.js for why this is proxied through Vercel instead of called
// directly from the bot's VM.
import { getGarminWorkoutDetail } from '../../../lib/garmin'

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.BOT_API_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const { workoutId } = req.query
  if (!workoutId) return res.status(400).json({ error: 'workoutId required' })

  try {
    const data = await getGarminWorkoutDetail(workoutId)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
