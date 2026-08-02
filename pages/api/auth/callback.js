// pages/api/auth/callback.js
// Completes the one-time Strava setup: exchanges the code for tokens and
// stores them server-side (see lib/strava.js) instead of in a cookie —
// the dashboard reads Strava data for every visitor from that stored token,
// there's no per-visitor session.
import { storeStravaAuth } from '../../../lib/strava'

export default async function handler(req, res) {
  const { code, state } = req.query
  if (!code) return res.redirect('/?error=no_code')
  if (state !== process.env.STRAVA_SETUP_SECRET) return res.status(403).send('Forbidden')

  try {
    const response = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    })
    const data = await response.json()
    if (data.errors || !data.access_token) return res.redirect('/?error=token_exchange')

    await storeStravaAuth({
      refresh_token: data.refresh_token,
      access_token: data.access_token,
      expires_at: data.expires_at,
      athlete: {
        name: `${data.athlete.firstname} ${data.athlete.lastname}`,
        avatar: data.athlete.profile,
        id: data.athlete.id,
      },
    })
    res.redirect('/?connected=strava')
  } catch (e) {
    res.redirect('/?error=server')
  }
}
