// pages/api/yazio/refresh.js
// Triggered by the dashboard's Refresh button: pulls today's summary live from Yazio.
// Rate-limited globally (not per-visitor) — see lib/ratelimit.js.
import { pullAndStoreYazioSummary } from '../../../lib/yazio'
import { yazioRefreshLimiter } from '../../../lib/ratelimit'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { success, reset } = await yazioRefreshLimiter.limit('yazio-refresh')
  if (!success) {
    return res.status(429).json({ error: 'rate_limited', retryAt: reset })
  }

  try {
    const summary = await pullAndStoreYazioSummary(new Date())
    res.json(summary)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
