// Pulls today's nutrition summary from Yazio (unofficial API) and caches it in Redis.
// Both the nightly cron and the dashboard's Refresh button call pullAndStoreYazioSummary.
import { Yazio } from 'yazio'
import { redis } from './redis'

const PROTEIN_TARGET = 150 // grams/day for marathon training
const SUMMARY_KEY = 'yazio:latest'
const NUTRIENT_KEYS = ['energy.energy', 'nutrient.carb', 'nutrient.fat', 'nutrient.protein']

function client() {
  const username = process.env.YAZIO_EMAIL
  const password = process.env.YAZIO_PASSWORD
  if (!username || !password) throw new Error('Yazio credentials not configured')

  // The yazio package's documented token-caching shape ({ token, onRefresh, credentials }
  // together) fails its own Zod validation at runtime — credentials-only is what actually
  // works, so we re-authenticate on every pull (same pattern as the Garmin integration).
  return new Yazio({ credentials: { username, password } })
}

function sumNutrients(meals) {
  const totals = Object.fromEntries(NUTRIENT_KEYS.map(k => [k, 0]))
  for (const meal of Object.values(meals)) {
    for (const key of NUTRIENT_KEYS) totals[key] += meal.nutrients[key] || 0
  }
  return totals
}

export async function pullAndStoreYazioSummary(date = new Date()) {
  const yazio = client()
  const daily = await yazio.user.getDailySummary({ date })
  const totals = sumNutrients(daily.meals)

  const protein = Math.round(totals['nutrient.protein'])
  const gap = PROTEIN_TARGET - protein

  const summary = {
    date: date.toISOString().split('T')[0],
    calories: Math.round(totals['energy.energy']),
    protein,
    carbs: Math.round(totals['nutrient.carb']),
    fat: Math.round(totals['nutrient.fat']),
    proteinTarget: PROTEIN_TARGET,
    proteinGap: gap > 0 ? gap : 0,
    proteinStatus: gap <= 0 ? 'on_target' : gap < 50 ? 'close' : 'deficit',
    fetchedAt: new Date().toISOString(),
  }

  await redis.set(SUMMARY_KEY, summary, { ex: 60 * 60 * 36 }) // 36h safety-net TTL
  return summary
}

export async function getStoredYazioSummary() {
  return redis.get(SUMMARY_KEY)
}
