import { useState, useEffect, useCallback } from 'react'
import Head from 'next/head'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine
} from 'recharts'
import dayjs from 'dayjs'

// ── Helpers ──────────────────────────────────────────────────────
const fmtPace = (decMin) => {
  if (!decMin) return '—'
  const m = Math.floor(decMin), s = Math.round((decMin - m) * 60)
  return `${m}:${s.toString().padStart(2, '0')}/km`
}
const fmtDur = (sec) => {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
const typeIcon = (t) => ({
  Run: '🏃', WeightTraining: '💪', Walk: '🚶',
  Ride: '🚴', Swim: '🏊', Hike: '⛰️',
}[t] || '⚡')
const typeColor = (t) => ({
  Run: '#F97316', WeightTraining: '#22D3EE', Walk: '#6B7280',
}[t] || '#6B7280')
const hrColor = (hr) => {
  if (!hr) return '#6B7280'
  if (hr < 130) return '#4ADE80'
  if (hr < 145) return '#22D3EE'
  if (hr < 158) return '#FBBF24'
  return '#EF4444'
}
const bbColor = (v) => {
  if (!v) return '#6B7280'
  if (v >= 70) return '#4ADE80'
  if (v >= 45) return '#FBBF24'
  return '#EF4444'
}

// ── Sub-components ────────────────────────────────────────────────
function StatCard({ label, value, sub, color = '#F9FAFB', pulse }) {
  return (
    <div className="stat-card relative overflow-hidden">
      {pulse && (
        <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-accent animate-ping" />
      )}
      <span className="metric-label">{label}</span>
      <span className="metric-value" style={{ color }}>{value ?? '—'}</span>
      {sub && <span className="metric-sub">{sub}</span>}
    </div>
  )
}

function SleepBar({ label, minutes, max, color }) {
  const pct = Math.min(100, (minutes / max) * 100)
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-mono text-muted w-12">{label}</span>
      <div className="flex-1 h-2 bg-border rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-mono text-muted w-10 text-right">{minutes}m</span>
    </div>
  )
}

function HRVTrend({ week }) {
  const data = week.filter(d => d.hrvAvg).map(d => ({
    date: dayjs(d.date).format('ddd'),
    hrv: d.hrvAvg,
    hrv5: d.hrv5min,
  }))
  if (!data.length) return <p className="text-muted text-xs font-mono">No HRV data yet</p>
  return (
    <ResponsiveContainer width="100%" height={100}>
      <LineChart data={data}>
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6B7280', fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
        <YAxis hide domain={['auto', 'auto']} />
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: '#6B7280' }}
        />
        <ReferenceLine y={40} stroke="#1F2937" strokeDasharray="3 3" />
        <Line dataKey="hrv" stroke="#22D3EE" strokeWidth={2} dot={{ r: 3, fill: '#22D3EE' }} name="HRV avg" />
        <Line dataKey="hrv5" stroke="#F97316" strokeWidth={1} dot={false} strokeDasharray="3 3" name="5-min high" />
      </LineChart>
    </ResponsiveContainer>
  )
}

function BodyBatteryChart({ week }) {
  const data = week.filter(d => d.bodyBattery?.highest).map(d => ({
    date: dayjs(d.date).format('ddd'),
    high: d.bodyBattery?.highest,
    low:  d.bodyBattery?.lowest,
    cur:  d.bodyBattery?.current,
  }))
  if (!data.length) return <p className="text-muted text-xs font-mono">No Body Battery data yet</p>
  return (
    <ResponsiveContainer width="100%" height={100}>
      <BarChart data={data} barGap={2}>
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6B7280', fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
        <YAxis hide domain={[0, 100]} />
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: '#6B7280' }}
        />
        <Bar dataKey="high" name="Peak BB" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={bbColor(d.high)} opacity={0.7} />)}
        </Bar>
        <Bar dataKey="low" name="Low BB" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={bbColor(d.low)} opacity={0.4} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function ActivityRow({ act }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-border last:border-0 hover:bg-white/[0.02] transition-colors px-2 -mx-2 rounded">
      <span className="text-lg w-6">{typeIcon(act.type)}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{act.name}</span>
          {act.prs > 0 && <span className="pill bg-accent/10 text-accent">⚡ {act.prs} PR</span>}
        </div>
        <div className="flex gap-3 mt-0.5 flex-wrap">
          <span className="text-xs font-mono text-muted">{dayjs(act.date).format('ddd DD MMM')}</span>
          {act.distance > 0 && <span className="text-xs font-mono text-muted">{act.distance}km</span>}
          <span className="text-xs font-mono text-muted">{fmtDur(act.duration)}</span>
          {act.pace && <span className="text-xs font-mono text-muted">{fmtPace(act.pace)}</span>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {act.avgHR && (
          <span className="text-xs font-mono font-bold" style={{ color: hrColor(act.avgHR) }}>
            {act.avgHR} bpm
          </span>
        )}
        {act.avgWatts && (
          <span className="text-xs font-mono text-muted">{Math.round(act.avgWatts)}W</span>
        )}
        {act.calories > 0 && (
          <span className="text-xs font-mono text-muted">{act.calories} kcal</span>
        )}
      </div>
    </div>
  )
}

function NutritionPanel({ data, loading, error, onRefresh }) {
  const proteinPct = data ? Math.min(100, (data.protein / data.proteinTarget) * 100) : 0

  return (
    <div className="stat-card">
      <span className="section-title">🌱 Nutrition (Yazio)</span>
      {loading ? (
        <span className="text-xs text-muted font-mono animate-pulse">Loading Yazio data...</span>
      ) : error ? (
        <p className="text-xs font-mono text-warn">⚠ {error}</p>
      ) : data ? (
        <div className="space-y-3">
          <div className="flex justify-between items-baseline">
            <span className="text-xs font-mono text-muted">Protein</span>
            <span className="font-mono font-bold" style={{ color: data.proteinStatus === 'on_target' ? '#4ADE80' : data.proteinStatus === 'close' ? '#FBBF24' : '#EF4444' }}>
              {data.protein}g / {data.proteinTarget}g
            </span>
          </div>
          <div className="h-2 bg-border rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-good transition-all" style={{ width: `${proteinPct}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1">
            <div className="text-center"><p className="text-xs text-muted font-mono">Calories</p><p className="text-sm font-mono font-bold">{data.calories}</p></div>
            <div className="text-center"><p className="text-xs text-muted font-mono">Carbs</p><p className="text-sm font-mono font-bold">{data.carbs}g</p></div>
            <div className="text-center"><p className="text-xs text-muted font-mono">Fat</p><p className="text-sm font-mono font-bold">{data.fat}g</p></div>
          </div>
          {data.proteinGap > 0 && (
            <p className="text-xs font-mono text-warn">⚠ {data.proteinGap}g protein still needed today</p>
          )}
          <p className="text-xs font-mono text-muted">Synced {dayjs(data.fetchedAt).format('HH:mm')}</p>
        </div>
      ) : (
        <div className="text-center py-4 space-y-2">
          <p className="text-xs text-muted font-mono">No Yazio data synced yet</p>
          <button
            onClick={onRefresh}
            className="text-xs font-mono bg-accent/10 hover:bg-accent/20 text-accent px-3 py-1.5 rounded transition-colors"
          >
            Pull now →
          </button>
        </div>
      )}
    </div>
  )
}

// ── Race Countdown ────────────────────────────────────────────────
function RaceCountdown({ days }) {
  const weeks = Math.floor(days / 7)
  const remaining = days % 7
  const totalWeeks = 23
  const weeksDone = Math.max(0, totalWeeks - weeks)
  const pct = Math.min(100, (weeksDone / totalWeeks) * 100)

  return (
    <div className="stat-card col-span-full">
      <div className="flex items-center justify-between mb-3">
        <span className="section-title mb-0">🏅 Goal Race — BYD Singapore Marathon · 6 Dec 2026</span>
        <span className="font-mono font-bold text-accent text-xl">{days}d</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs font-mono text-muted whitespace-nowrap">
          Week {weeksDone}/{totalWeeks} · {weeks}w {remaining}d to go
        </span>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────
export default function Dashboard() {
  const [strava, setStrava]   = useState(null)
  const [garmin, setGarmin]   = useState(null)
  const [yazio, setYazio]     = useState(null)
  const [loading, setLoading] = useState({ strava: true, garmin: true, yazio: true })
  const [error, setError]     = useState({})
  const [athlete, setAthlete] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  const fetchStrava = useCallback(async () => {
    try {
      const r = await fetch('/api/strava')
      const d = await r.json()
      if (d.error) { setError(p => ({ ...p, strava: d.error })); return }
      setStrava(d.pending ? null : d)
      setAthlete(d.athlete || null)
      setError(p => ({ ...p, strava: null }))
    } catch { setError(p => ({ ...p, strava: 'fetch_error' })) }
    finally { setLoading(p => ({ ...p, strava: false })) }
  }, [])

  const fetchGarmin = useCallback(async () => {
    try {
      const r = await fetch('/api/garmin')
      const d = await r.json()
      if (d.error) { setError(p => ({ ...p, garmin: d.error })); return }
      setGarmin(d)
      setError(p => ({ ...p, garmin: null }))
    } catch { setError(p => ({ ...p, garmin: 'fetch_error' })) }
    finally { setLoading(p => ({ ...p, garmin: false })) }
  }, [])

  const fetchYazio = useCallback(async () => {
    try {
      const r = await fetch('/api/yazio')
      const d = await r.json()
      if (d.error) { setError(p => ({ ...p, yazio: d.error })); return }
      setYazio(d.pending ? null : d)
      setError(p => ({ ...p, yazio: null }))
    } catch { setError(p => ({ ...p, yazio: 'fetch_error' })) }
    finally { setLoading(p => ({ ...p, yazio: false })) }
  }, [])

  const refreshYazio = useCallback(async () => {
    setLoading(p => ({ ...p, yazio: true }))
    try {
      const r = await fetch('/api/yazio/refresh', { method: 'POST' })
      const d = await r.json()
      if (r.status === 429) { setError(p => ({ ...p, yazio: 'Refreshed recently — try again in a few minutes' })); return }
      if (d.error) { setError(p => ({ ...p, yazio: d.error })); return }
      setYazio(d)
      setError(p => ({ ...p, yazio: null }))
    } catch { setError(p => ({ ...p, yazio: 'fetch_error' })) }
    finally { setLoading(p => ({ ...p, yazio: false })) }
  }, [])

  useEffect(() => {
    fetchStrava()
    fetchGarmin()
    fetchYazio()
    setLastRefresh(new Date())
  }, [fetchStrava, fetchGarmin, fetchYazio])

  const handleRefresh = () => {
    setLoading({ strava: true, garmin: true, yazio: true })
    fetchStrava()
    fetchGarmin()
    refreshYazio()
    setLastRefresh(new Date())
  }

  const today = garmin?.today
  const week  = garmin?.week || []
  const runs  = strava?.activities?.filter(a => a.type === 'Run') || []
  const lastRun = runs[0]
  const daysUntilRace = strava?.stats?.daysUntilRace

  return (
    <>
      <Head>
        <title>Navjeet's Fitness Tracker</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏃</text></svg>" />
      </Head>

      <div className="min-h-screen bg-midnight text-white">
        {/* Header */}
        <header className="border-b border-border px-4 py-3 flex items-center justify-between sticky top-0 bg-midnight/95 backdrop-blur z-10">
          <div className="flex items-center gap-3">
            <span className="font-mono font-bold text-accent">⚡ NAVJEET'S FITNESS TRACKER</span>
            {athlete && (
              <div className="flex items-center gap-2 border-l border-border pl-3">
                {athlete.avatar && <img src={athlete.avatar} alt="" className="w-6 h-6 rounded-full" />}
                <span className="text-xs font-mono text-muted">{athlete.name}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {lastRefresh && (
              <span className="text-xs font-mono text-muted hidden sm:block">
                Updated {dayjs(lastRefresh).format('HH:mm')}
              </span>
            )}
            <button
              onClick={handleRefresh}
              className="text-xs font-mono text-muted hover:text-white transition-colors border border-border px-3 py-1.5 rounded"
            >
              ↻ Refresh
            </button>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
          {/* Race countdown */}
          {daysUntilRace && (
            <div className="grid grid-cols-1">
              <RaceCountdown days={daysUntilRace} />
            </div>
          )}

          {/* Top stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Body Battery"
              value={today?.bodyBattery?.current ?? (loading.garmin ? '...' : '—')}
              sub={`Peak ${today?.bodyBattery?.highest ?? '—'} · Low ${today?.bodyBattery?.lowest ?? '—'}`}
              color={bbColor(today?.bodyBattery?.current)}
              pulse
            />
            <StatCard
              label="HRV (last night)"
              value={today?.hrvAvg ? `${today.hrvAvg}ms` : (loading.garmin ? '...' : '—')}
              sub={`5-min high ${today?.hrv5min ?? '—'}ms · 7d avg ${garmin?.summary?.avg7dHRV ?? '—'}ms`}
              color="#22D3EE"
            />
            <StatCard
              label="Resting HR"
              value={today?.rhr ? `${today.rhr} bpm` : (loading.garmin ? '...' : '—')}
              sub="7-day avg"
              color={today?.rhr < 55 ? '#4ADE80' : '#F9FAFB'}
            />
            <StatCard
              label="Sleep"
              value={today?.sleep?.hours ? `${today.sleep.hours}h` : (loading.garmin ? '...' : '—')}
              sub={today?.sleep ? `Deep ${today.sleep.deep}m · REM ${today.sleep.rem}m` : '—'}
              color={today?.sleep?.hours >= 7 ? '#4ADE80' : today?.sleep?.hours >= 6 ? '#FBBF24' : '#EF4444'}
            />
          </div>

          {/* Second stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Weekly km"
              value={loading.strava ? '...' : `${strava?.stats?.weeklyKm ?? '—'}km`}
              sub={`${strava?.stats?.runCount ?? 0} runs · 14 days`}
              color="#F97316"
            />
            <StatCard
              label="Longest run"
              value={loading.strava ? '...' : `${strava?.stats?.longestRun ?? '—'}km`}
              sub="Last 14 days"
            />
            <StatCard
              label="Avg HR (runs)"
              value={loading.strava ? '...' : (strava?.stats?.avgHR ? `${strava.stats.avgHR} bpm` : '—')}
              sub="Last 14 days"
              color={hrColor(strava?.stats?.avgHR)}
            />
            <StatCard
              label="Stress (avg)"
              value={today?.stress ?? (loading.garmin ? '...' : '—')}
              sub="Today"
              color={today?.stress < 25 ? '#4ADE80' : today?.stress < 50 ? '#FBBF24' : '#EF4444'}
            />
          </div>

          {/* Last run spotlight */}
          {lastRun && (
            <div className="stat-card border-accent/30">
              <span className="section-title">Last Run</span>
              <div className="flex flex-wrap gap-6">
                <div>
                  <p className="metric-label">Distance</p>
                  <p className="metric-value text-accent">{lastRun.distance}km</p>
                </div>
                <div>
                  <p className="metric-label">Pace</p>
                  <p className="metric-value">{fmtPace(lastRun.pace)}</p>
                </div>
                <div>
                  <p className="metric-label">Avg HR</p>
                  <p className="metric-value" style={{ color: hrColor(lastRun.avgHR) }}>{lastRun.avgHR ?? '—'} bpm</p>
                </div>
                {lastRun.avgWatts && (
                  <div>
                    <p className="metric-label">Avg Power</p>
                    <p className="metric-value">{Math.round(lastRun.avgWatts)}W</p>
                  </div>
                )}
                <div>
                  <p className="metric-label">Duration</p>
                  <p className="metric-value">{fmtDur(lastRun.duration)}</p>
                </div>
                {lastRun.prs > 0 && (
                  <div>
                    <p className="metric-label">PRs</p>
                    <p className="metric-value text-accent">⚡ {lastRun.prs}</p>
                  </div>
                )}
                {lastRun.elevation > 0 && (
                  <div>
                    <p className="metric-label">Elevation</p>
                    <p className="metric-value">{lastRun.elevation}m</p>
                  </div>
                )}
              </div>
              <p className="text-xs font-mono text-muted mt-2">{lastRun.name} · {dayjs(lastRun.date).format('ddd DD MMM')}</p>
            </div>
          )}

          {/* Charts row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="stat-card">
              <span className="section-title">HRV Trend — 7 Days</span>
              {loading.garmin ? (
                <div className="h-24 flex items-center justify-center">
                  <span className="text-xs text-muted font-mono animate-pulse">Loading Garmin data...</span>
                </div>
              ) : (
                <HRVTrend week={week} />
              )}
              <p className="text-xs font-mono text-muted mt-2">
                — avg HRV &nbsp; - - 5-min high &nbsp;
                <span className="text-zone2">Target: &gt;40ms</span>
              </p>
            </div>
            <div className="stat-card">
              <span className="section-title">Body Battery — 7 Days</span>
              {loading.garmin ? (
                <div className="h-24 flex items-center justify-center">
                  <span className="text-xs text-muted font-mono animate-pulse">Loading Garmin data...</span>
                </div>
              ) : (
                <BodyBatteryChart week={week} />
              )}
              <p className="text-xs font-mono text-muted mt-2">
                <span className="text-good">■ 70+</span> &nbsp;
                <span className="text-warn">■ 45–69</span> &nbsp;
                <span className="text-pulse">■ &lt;45</span>
              </p>
            </div>
          </div>

          {/* Sleep detail + Nutrition */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="stat-card">
              <span className="section-title">Sleep — Last Night</span>
              {loading.garmin ? (
                <span className="text-xs text-muted font-mono animate-pulse">Loading...</span>
              ) : today?.sleep ? (
                <div className="space-y-3">
                  <div className="flex items-baseline gap-2">
                    <span className="metric-value" style={{ color: today.sleep.hours >= 7 ? '#4ADE80' : today.sleep.hours >= 6 ? '#FBBF24' : '#EF4444' }}>
                      {today.sleep.hours}h
                    </span>
                    {today.sleep.overnightHRV && (
                      <span className="text-xs font-mono text-muted">HRV overnight avg {today.sleep.overnightHRV}ms</span>
                    )}
                  </div>
                  <div className="space-y-2 pt-1">
                    <SleepBar label="Deep" minutes={today.sleep.deep} max={120} color="#6366F1" />
                    <SleepBar label="REM"  minutes={today.sleep.rem}  max={120} color="#22D3EE" />
                  </div>
                  <div className="pt-2 border-t border-border">
                    <p className="text-xs font-mono text-muted">7-day avg sleep: {garmin?.summary?.avgSleep ?? '—'}h</p>
                    {today.sleep.hours < 7 && (
                      <p className="text-xs font-mono text-warn mt-1">⚠ Below 7h target — prioritise sleep tonight</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs font-mono text-muted">No sleep data for today. Ensure Garmin synced.</p>
              )}
            </div>
            <NutritionPanel data={yazio} loading={loading.yazio} error={error.yazio} onRefresh={refreshYazio} />
          </div>

          {/* Activity log */}
          <div className="stat-card">
            <span className="section-title">Activities — Last 14 Days</span>
            {loading.strava ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-12 bg-border/30 rounded animate-pulse" />
                ))}
              </div>
            ) : strava?.activities?.length ? (
              <div>
                {strava.activities.map(a => <ActivityRow key={a.id} act={a} />)}
              </div>
            ) : (
              <p className="text-xs font-mono text-muted">No activities in last 14 days</p>
            )}
          </div>

          {/* Weekly sleep overview */}
          {week.length > 0 && (
            <div className="stat-card">
              <span className="section-title">Sleep — 7 Day Overview</span>
              <div className="flex gap-2 items-end h-20">
                {week.map((d, i) => {
                  const h = d.sleep?.hours || 0
                  const pct = Math.min(100, (h / 9) * 100)
                  const col = h >= 7 ? '#4ADE80' : h >= 6 ? '#FBBF24' : h > 0 ? '#EF4444' : '#1F2937'
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full flex items-end justify-center" style={{ height: '60px' }}>
                        <div
                          className="w-full rounded-t transition-all"
                          style={{ height: `${pct}%`, background: col, minHeight: h > 0 ? 4 : 0 }}
                          title={`${dayjs(d.date).format('ddd')}: ${h}h`}
                        />
                      </div>
                      <span className="text-xs font-mono text-muted">{dayjs(d.date).format('dd')}</span>
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-4 mt-2">
                <span className="text-xs font-mono text-good">■ 7h+</span>
                <span className="text-xs font-mono text-warn">■ 6–7h</span>
                <span className="text-xs font-mono text-pulse">■ &lt;6h</span>
              </div>
            </div>
          )}

          {/* Footer */}
          <footer className="text-center py-4 border-t border-border">
            <p className="text-xs font-mono text-muted">
              Fitness Tracker · Strava · Garmin · Yazio &nbsp;·&nbsp;
              <a href="https://claude.ai" target="_blank" rel="noreferrer" className="text-accent hover:underline">Ask Claude →</a>
            </p>
          </footer>
        </main>
      </div>
    </>
  )
}
