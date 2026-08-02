// pages/api/yazio.js
// Returns the most recently synced nutrition summary (see lib/yazio.js).
// Data is populated by the nightly cron (pages/api/cron/yazio.js) or the
// dashboard's Refresh button (pages/api/yazio/refresh.js) — this route only reads.
import { getStoredYazioSummary } from '../../lib/yazio'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  try {
    const summary = await getStoredYazioSummary()
    if (!summary) {
      return res.json({ pending: true, message: 'No Yazio data synced yet — press Refresh.' })
    }
    res.json(summary)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
