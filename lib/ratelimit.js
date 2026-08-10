// Global (not per-visitor) rate limits for routes that trigger live logins against
// unofficial third-party APIs (Garmin, Yazio) — repeated auth attempts risk the
// underlying account getting flagged, regardless of who's making the request.
import { Ratelimit } from '@upstash/ratelimit'
import { redis } from './redis.js'

export const yazioRefreshLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(1, '5 m'),
  prefix: 'ratelimit:yazio-refresh',
})
