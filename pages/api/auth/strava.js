// pages/api/auth/strava.js
// Step 1: Redirect user to Strava OAuth
export default function handler(req, res) {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/callback`,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
  })
  res.redirect(`https://www.strava.com/oauth/authorize?${params}`)
}
