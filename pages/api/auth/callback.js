// pages/api/auth/callback.js
// Exchanges auth code for tokens, stores in cookie
export default async function handler(req, res) {
  const { code } = req.query
  if (!code) return res.redirect('/?error=no_code')

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
    if (data.errors) return res.redirect('/?error=token_exchange')

    // Store tokens in secure cookies (7 days)
    const cookieOpts = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=604800'
    res.setHeader('Set-Cookie', [
      `strava_access_token=${data.access_token}; ${cookieOpts}`,
      `strava_refresh_token=${data.refresh_token}; ${cookieOpts}`,
      `strava_expires_at=${data.expires_at}; ${cookieOpts}`,
      `strava_athlete=${encodeURIComponent(JSON.stringify({
        name: `${data.athlete.firstname} ${data.athlete.lastname}`,
        avatar: data.athlete.profile,
        id: data.athlete.id,
      }))}; Path=/; SameSite=Lax; Max-Age=604800`,
    ])
    res.redirect('/?connected=strava')
  } catch (e) {
    res.redirect('/?error=server')
  }
}
