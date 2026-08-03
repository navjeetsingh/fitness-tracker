// Maps Garmin Connect's ML-inferred strength-training exercise categories to muscle
// groups. Garmin's API has no muscle-group field itself — this table is our own
// best-effort mapping over its exercise category enum. Categories Garmin can't
// classify confidently come back as UNKNOWN; since you correct those in the Garmin
// app after a workout, we re-fetch (not permanently cache) exercise sets so a later
// sync can pick up the correction — see CACHE_TTL in lib/garmin.js.
const CATEGORY_TO_GROUP = {
  SQUAT: 'Legs & Glutes',
  LUNGE: 'Legs & Glutes',
  LEG_PRESS: 'Legs & Glutes',
  LEG_CURL: 'Legs & Glutes',
  LEG_EXTENSION: 'Legs & Glutes',
  LEG_RAISE: 'Legs & Glutes',
  CALF_RAISE: 'Legs & Glutes',
  HIP_RAISE: 'Legs & Glutes',
  HIP_ABDUCTION: 'Legs & Glutes',
  HIP_ADDUCTION: 'Legs & Glutes',
  HIP_STABILITY: 'Legs & Glutes',
  HIP_SWING: 'Legs & Glutes',
  HYPEREXTENSION: 'Legs & Glutes',
  DEADLIFT: 'Back & Legs',
  PULL_UP: 'Back',
  ROW: 'Back',
  LAT_PULLDOWN: 'Back',
  BENCH_PRESS: 'Chest',
  PUSH_UP: 'Chest',
  FLYE: 'Chest',
  CHEST_PRESS: 'Chest',
  SHOULDER_PRESS: 'Shoulders',
  LATERAL_RAISE: 'Shoulders',
  SHRUG: 'Shoulders',
  TRICEPS_EXTENSION: 'Arms',
  CURL: 'Arms',
  BICEP_CURL: 'Arms',
  CRUNCH: 'Core',
  SIT_UP: 'Core',
  PLANK: 'Core',
  CORE: 'Core',
  CHOP: 'Core',
  CARDIO: 'Full Body',
  RUN: 'Full Body',
  WARM_UP: 'Full Body',
  TOTAL_BODY: 'Full Body',
  CARRY: 'Full Body',
  OLYMPIC_LIFT: 'Full Body',
  PLYO: 'Full Body',
}

/**
 * Fetches the raw per-set exercise data for a strength-training activity. Hits an
 * undocumented internal endpoint (no equivalent in the garmin-connect npm package;
 * this URL pattern matches other community Garmin API wrappers). gc.get() takes a
 * full URL — unlike the package's own methods, it doesn't prepend the API host —
 * so we build it from the same GC_API base the package uses internally. gc.url is
 * marked private in the package's TypeScript types, but that's erased at runtime;
 * the property exists on the real object.
 *
 * @param {import('garmin-connect').default} gc - an authenticated GarminConnect client
 * @param {number} activityId - Garmin activity ID
 * @returns {Promise<Array>} raw exerciseSets array (each set includes exercises,
 *   setType, repetitionCount, weight, duration); empty array if none.
 */
export async function fetchActivityExerciseSets(gc, activityId) {
  const data = await gc.get(`${gc.url.GC_API}/activity-service/activity/${activityId}/exerciseSets`)
  return data?.exerciseSets || []
}

/**
 * Aggregates raw exercise sets into a muscle-group breakdown, keeping only the
 * highest-confidence exercise candidate per set.
 *
 * @param {Array} exerciseSets - raw sets from fetchActivityExerciseSets
 * @returns {{breakdown: Array<{group: string, sets: number}>, unclassifiedSets: number}}
 *   breakdown sorted by set count descending.
 */
export function categorizeExerciseSets(exerciseSets) {
  const counts = {}
  let unclassifiedSets = 0

  for (const set of exerciseSets) {
    if (set.setType !== 'ACTIVE') continue
    const best = set.exercises?.[0]
    const group = best && best.category !== 'UNKNOWN' ? CATEGORY_TO_GROUP[best.category] : null
    if (group) {
      counts[group] = (counts[group] || 0) + 1
    } else {
      unclassifiedSets++
    }
  }

  const breakdown = Object.entries(counts)
    .map(([group, sets]) => ({ group, sets }))
    .sort((a, b) => b.sets - a.sets)

  return { breakdown, unclassifiedSets }
}

/**
 * Best-effort muscle-group breakdown for a strength-training activity. Returns null
 * (rather than throwing) if Garmin's undocumented endpoint fails or the activity has
 * no logged sets, so the rest of the activity detail view still renders.
 *
 * @param {import('garmin-connect').default} gc - an authenticated GarminConnect client
 * @param {number} activityId - Garmin activity ID
 * @returns {Promise<{breakdown: Array<{group: string, sets: number}>, unclassifiedSets: number}|null>}
 */
export async function getMuscleGroupBreakdown(gc, activityId) {
  try {
    const sets = await fetchActivityExerciseSets(gc, activityId)
    if (!sets.length) return null
    return categorizeExerciseSets(sets)
  } catch {
    return null
  }
}
