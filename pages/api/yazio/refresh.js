// pages/api/yazio/refresh.js
// Triggered by the dashboard's Refresh button: pulls today's summary live from Yazio.
import { pullAndStoreYazioSummary } from '../../../lib/yazio'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const summary = await pullAndStoreYazioSummary(new Date())
    res.json(summary)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
