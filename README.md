# ⚡ Fitness Tracker

Real-time fitness dashboard pulling from Strava, Garmin Connect, and Yazio.

**Live:** https://navjeet-fitness-tracker.vercel.app

---

## Stack
- **Next.js 14** — frontend + serverless API routes
- **Vercel** — free hosting + deployment
- **Strava API** — official OAuth API (activities, HR, power, pace)
- **garmin-connect** — npm package for Garmin health data (sleep, HRV, Body Battery, RHR)
- **Yazio** — manual entry (no public API exists)

---

## Setup

### 1. Clone & install
```bash
git clone https://github.com/navjeetsingh/fitness-tracker
cd fitness-tracker
npm install
```

### 2. Environment variables
Copy `.env.example` to `.env.local` and fill in:
```bash
cp .env.example .env.local
```

| Variable | Where to find it |
|---|---|
| `STRAVA_CLIENT_ID` | strava.com/settings/api → Client ID (yours is 255046) |
| `STRAVA_CLIENT_SECRET` | strava.com/settings/api → click Show on Client Secret |
| `GARMIN_EMAIL` | Your Garmin Connect login email |
| `GARMIN_PASSWORD` | Your Garmin Connect password |
| `NEXT_PUBLIC_BASE_URL` | Your Vercel URL after first deploy |

### 3. Run locally
```bash
npm run dev
# Open http://localhost:3000
```

### 4. Deploy to Vercel
1. Push to GitHub
2. Go to vercel.com → New Project → Import your GitHub repo
3. Add all environment variables in Vercel dashboard → Settings → Environment Variables
4. Deploy — your dashboard will be live at `https://navjeet-fitness-tracker.vercel.app`

### 5. Connect Strava
Visit your dashboard URL and click **Connect Strava** — authorise once and it auto-refreshes.

---

## Data Sources

| Source | What it shows | Method |
|---|---|---|
| Strava | Runs, pace, HR, power, elevation, PRs | Official OAuth API |
| Garmin | Sleep, HRV, Body Battery, RHR, stress | garmin-connect npm package |
| Yazio | Protein, calories, macros | Manual entry (no public API) |

---

## Future Plans
- Additional sport types (cycling, swimming, strength)
- Weekly/monthly trend views
- Nutrition history tracking
- Race goal tracking beyond marathon
