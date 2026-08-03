// pages/api/yazio.js
// Returns today's synced nutrition summary + the last 7 days for the weekly trend
// (see lib/yazio.js). Data is populated by the nightly cron, the dashboard's Refresh
// button, or its silent auto-refresh — this route only reads.
import { getStoredYazioDay, getYazioWeekly } from '../../lib/yazio'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  try {
    const todayStr = new Date().toISOString().split('T')[0]
    const [today, week] = await Promise.all([
      getStoredYazioDay(todayStr),
      getYazioWeekly(),
    ])
    if (!today) {
      return res.json({ pending: true, message: 'No nutrition data synced yet — press Refresh.', week })
    }
    res.json({ today, week })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
