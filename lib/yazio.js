// Pulls a day's nutrition summary from Yazio (unofficial API), broken down per meal,
// and caches it in Redis keyed by date — so past days stay available for per-activity
// nutrition context and a weekly trend, not just "the latest pull".
// Synced by: the nightly cron (00:00 Asia/Bangkok — see pages/api/cron/yazio.js), the
// dashboard's Refresh button, and a silent auto-refresh when the dashboard is opened
// with stale data (see refreshYazio in pages/index.js).
import { Yazio } from 'yazio'
import { redis } from './redis'

const PROTEIN_TARGET = 150 // grams/day for marathon training
const DAY_KEY_TTL = 40 * 24 * 60 * 60 // 40 days — covers weekly trend + activity history lookups
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack']
const NUTRIENT_KEYS = ['energy.energy', 'nutrient.carb', 'nutrient.fat', 'nutrient.protein']

const dateKey = (date) => date.toISOString().split('T')[0]
const redisKey = (dateStr) => `yazio:day:${dateStr}`

function client() {
  const username = process.env.YAZIO_EMAIL
  const password = process.env.YAZIO_PASSWORD
  if (!username || !password) throw new Error('Yazio credentials not configured')

  // The yazio package's documented token-caching shape ({ token, onRefresh, credentials }
  // together) fails its own Zod validation at runtime — credentials-only is what actually
  // works, so we re-authenticate on every pull (same pattern as the Garmin integration).
  return new Yazio({ credentials: { username, password } })
}

function sumNutrients(nutrients) {
  const calories = Math.round(nutrients['energy.energy'] || 0)
  const protein = Math.round(nutrients['nutrient.protein'] || 0)
  const carbs = Math.round(nutrients['nutrient.carb'] || 0)
  const fat = Math.round(nutrients['nutrient.fat'] || 0)
  return { calories, protein, carbs, fat }
}

function buildDaySummary(dateStr, daily) {
  const meals = {}
  const totalNutrients = Object.fromEntries(NUTRIENT_KEYS.map(k => [k, 0]))

  for (const mealType of MEAL_TYPES) {
    const nutrients = daily.meals?.[mealType]?.nutrients
    meals[mealType] = sumNutrients(nutrients || {})
    for (const k of NUTRIENT_KEYS) totalNutrients[k] += nutrients?.[k] || 0
  }

  const total = sumNutrients(totalNutrients)
  const gap = PROTEIN_TARGET - total.protein

  return {
    date: dateStr,
    meals,
    total,
    proteinTarget: PROTEIN_TARGET,
    proteinGap: gap > 0 ? gap : 0,
    proteinStatus: gap <= 0 ? 'on_target' : gap < 50 ? 'close' : 'deficit',
    fetchedAt: new Date().toISOString(),
  }
}

/**
 * Pulls a day's nutrition summary live from Yazio and stores it in Redis.
 *
 * @param {Date} [date] - defaults to today
 * @returns {Promise<object>} the stored day summary (date, meals, total, protein
 *   target/gap/status, fetchedAt)
 */
export async function pullAndStoreYazioSummary(date = new Date()) {
  const yazio = client()
  const dateStr = dateKey(date)
  const daily = await yazio.user.getDailySummary({ date })
  const summary = buildDaySummary(dateStr, daily)

  await redis.set(redisKey(dateStr), summary, { ex: DAY_KEY_TTL })
  return summary
}

/**
 * Cache-only — never triggers a live Yazio login. A day that was never synced just
 * comes back null; we don't want arbitrary activity-detail clicks (an unauthenticated,
 * public endpoint) to be able to trigger fresh third-party logins on demand.
 *
 * @param {string} dateStr - date in YYYY-MM-DD format
 * @returns {Promise<object|null>}
 */
export async function getStoredYazioDay(dateStr) {
  return redis.get(redisKey(dateStr))
}

/**
 * The last 7 days of stored nutrition summaries (oldest first), for the weekly
 * protein trend chart. Days that were never synced come back as {date, total: null}.
 *
 * @returns {Promise<object[]>}
 */
export async function getYazioWeekly() {
  const today = new Date()
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = dateKey(d)
    const day = await redis.get(redisKey(dateStr))
    days.push(day || { date: dateStr, total: null })
  }
  return days
}
