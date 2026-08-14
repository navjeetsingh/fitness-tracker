// Garmin data for the Discord bot's MCP tools, proxied through Vercel rather than
// fetched directly from the Oracle VM — Garmin's anti-bot system has repeatedly
// flagged the VM's IP as suspicious datacenter traffic, while Vercel's IP has never
// been flagged all the times this app has hit Garmin from it. Protected by
// BOT_API_SECRET since (unlike /api/garmin, the dashboard's cached 7-day summary)
// this triggers live historical logins on demand and shouldn't be public.
import { getGarminHistoricalRange } from '../../../lib/garmin'

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.BOT_API_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const { startDate, endDate } = req.query
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' })

  try {
    const data = await getGarminHistoricalRange(startDate, endDate)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
