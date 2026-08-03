// pages/api/yazio/refresh.js
// Triggered by the dashboard's Refresh button (and its silent auto-refresh on load
// when data is stale): pulls today's summary live from Yazio.
// Rate-limited globally (not per-visitor) — see lib/ratelimit.js.
import { pullAndStoreYazioSummary, getYazioWeekly } from '../../../lib/yazio'
import { yazioRefreshLimiter } from '../../../lib/ratelimit'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { success, reset } = await yazioRefreshLimiter.limit('yazio-refresh')
  if (!success) {
    return res.status(429).json({ error: 'rate_limited', retryAt: reset })
  }

  try {
    const today = await pullAndStoreYazioSummary(new Date())
    const week = await getYazioWeekly()
    res.json({ today, week })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
