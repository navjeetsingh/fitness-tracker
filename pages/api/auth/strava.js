// pages/api/auth/strava.js
// Private, one-time setup step — NOT linked from the UI. The dashboard is public,
// so this is gated by STRAVA_SETUP_SECRET to stop random visitors from overwriting
// the stored connection with their own Strava account. Visit with ?key=<secret>.
export default function handler(req, res) {
  if (req.query.key !== process.env.STRAVA_SETUP_SECRET) {
    return res.status(403).send('Forbidden')
  }

  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/callback`,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state: process.env.STRAVA_SETUP_SECRET,
  })
  res.redirect(`https://www.strava.com/oauth/authorize?${params}`)
}
