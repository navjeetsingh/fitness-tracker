// Local stdio MCP server exposing the dashboard's Garmin/Strava/Yazio data as tools
// for the Discord bot's `claude -p` subprocess (see bot/claude.js). Loaded via
// --mcp-config so Claude can pull whatever date range or data type a given question
// actually needs, instead of the bot guessing from regex over the user's message.
//
// Garmin calls are proxied through the Vercel-hosted /api/bot/* routes instead of
// running the unofficial Garmin client directly on this VM — Garmin's anti-bot system
// has repeatedly flagged this VM's IP as suspicious datacenter traffic, while Vercel's
// IP has never been flagged despite the same app hitting Garmin from it constantly.
// Strava/Yazio don't have this problem, so those stay as direct lib calls.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { fetchStravaData, getStravaActivitiesInRange, getStravaActivityDetail } from '../lib/strava.js'
import { getYazioWeekly, getYazioHistoricalRange } from '../lib/yazio.js'

const server = new McpServer({ name: 'fitness-tracker', version: '1.0.0' })

const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
const json = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] })

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL
const BOT_API_SECRET = process.env.BOT_API_SECRET

async function fetchGarminApi(path) {
  const r = await fetch(`${BASE_URL}${path}`, {
    headers: path.startsWith('/api/bot/') ? { Authorization: `Bearer ${BOT_API_SECRET}` } : {},
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data.error || `Garmin API request failed: ${r.status}`)
  return data
}

server.registerTool(
  'get_recent_snapshot',
  {
    title: 'Recent fitness snapshot',
    description:
      'Current overview: last 7 days of Garmin health data (sleep, HRV, Body Battery, RHR, stress, muscle groups), ' +
      'last 14 days of Strava activities, and last 7 days of Yazio nutrition. Use this first for "how am I doing" ' +
      'style questions; use the *_range tools only when the question needs dates outside these windows.',
    inputSchema: {},
  },
  async () => {
    const [garmin, strava, yazio] = await Promise.all([
      fetchGarminApi('/api/garmin').catch((e) => ({ error: e.message })),
      fetchStravaData().catch((e) => ({ error: e.message })),
      getYazioWeekly().catch((e) => ({ error: e.message })),
    ])
    return json({ today: new Date().toISOString().split('T')[0], garmin, strava, yazio })
  }
)

server.registerTool(
  'get_garmin_range',
  {
    title: 'Garmin health data for a date range',
    description:
      'Sleep, HRV, Body Battery, resting heart rate, stress, and strength-training muscle groups for an arbitrary ' +
      'date range — use for questions about weeks/months ago, not just the last 7 days. Triggers a live Garmin ' +
      'login for any day not already cached, so prefer the narrowest range that answers the question.',
    inputSchema: { startDate: dateArg, endDate: dateArg },
  },
  async ({ startDate, endDate }) => json(await fetchGarminApi(`/api/bot/garmin-range?startDate=${startDate}&endDate=${endDate}`))
)

server.registerTool(
  'get_strava_range',
  {
    title: 'Strava activities for a date range',
    description:
      'Public Strava activities (runs, rides, etc.) within an arbitrary date range, with pace/HR/elevation/effort ' +
      'per activity — use for questions about weeks/months ago, not just the last 14 days.',
    inputSchema: { startDate: dateArg, endDate: dateArg },
  },
  async ({ startDate, endDate }) => json(await getStravaActivitiesInRange(startDate, endDate))
)

server.registerTool(
  'get_strava_activity_detail',
  {
    title: 'Full detail for one Strava activity',
    description:
      'Full detail for a single Strava activity by ID — description, tags, gear, route polyline, photos. Use when ' +
      'the user asks about a specific activity (e.g. after get_recent_snapshot or get_strava_range surfaces its id).',
    inputSchema: { activityId: z.union([z.string(), z.number()]) },
  },
  async ({ activityId }) => json(await getStravaActivityDetail(activityId))
)

server.registerTool(
  'get_yazio_range',
  {
    title: 'Nutrition data for a date range',
    description:
      'Daily nutrition summaries (calories, protein/carbs/fat, protein target vs. gap) for an arbitrary date range ' +
      '— use for questions about weeks/months ago, not just the last 7 days. Triggers a live Yazio login for any ' +
      'day not already synced, so prefer the narrowest range that answers the question.',
    inputSchema: { startDate: dateArg, endDate: dateArg },
  },
  async ({ startDate, endDate }) => json(await getYazioHistoricalRange(startDate, endDate))
)

server.registerTool(
  'get_upcoming_workouts',
  {
    title: 'Scheduled Runna sessions and race events',
    description:
      "Titles and dates of the athlete's scheduled Runna training sessions and any calendar race events, pulled " +
      'from Garmin (Runna syncs its plan into Garmin Connect — this is the plan, read-only). Use this to know what ' +
      "is coming up next, not to invent or replace the plan. Returns a workoutId per session for get_workout_detail.",
    inputSchema: { days: z.number().int().min(1).max(60).optional() },
  },
  async ({ days }) => json(await fetchGarminApi(`/api/bot/garmin-workouts${days ? `?days=${days}` : ''}`))
)

server.registerTool(
  'get_workout_detail',
  {
    title: 'Full structure of one planned workout',
    description:
      'Target paces/HR zones per step for a single planned Runna session (from a workoutId returned by ' +
      'get_upcoming_workouts) — e.g. "10km at a conversational pace" or specific interval targets. Use this to ' +
      'compare what a session actually asked for against what was run.',
    inputSchema: { workoutId: z.union([z.string(), z.number()]) },
  },
  async ({ workoutId }) => json(await fetchGarminApi(`/api/bot/garmin-workout-detail?workoutId=${workoutId}`))
)

await server.connect(new StdioServerTransport())
