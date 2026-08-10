// Shared date-range enumeration for historical queries (bot/mcp-server.js) that need
// day-by-day iteration over an arbitrary range, beyond the dashboard's fixed 7/14-day
// rolling windows.

/**
 * @param {string} startDateStr - YYYY-MM-DD, inclusive
 * @param {string} endDateStr - YYYY-MM-DD, inclusive
 * @returns {string[]} dates in YYYY-MM-DD format, oldest first
 */
export function enumerateDates(startDateStr, endDateStr) {
  const start = new Date(startDateStr + 'T00:00:00Z')
  const end = new Date(endDateStr + 'T00:00:00Z')
  const dates = []
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().split('T')[0])
  }
  return dates
}
