// pages/api/cron/yazio.js
// Invoked daily by Vercel Cron (see vercel.json) at 00:00 Asia/Bangkok.
// Vercel sends `Authorization: Bearer $CRON_SECRET` on scheduled invocations.
import { pullAndStoreYazioSummary } from '../../../lib/yazio'

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  try {
    const summary = await pullAndStoreYazioSummary(new Date())
    res.json({ status: 'ok', summary })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
