import { useState, useEffect, useCallback, useRef } from 'react'
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
const stressColor = (v) => {
  if (v == null) return '#1F2937'
  if (v < 25) return '#4ADE80'
  if (v < 50) return '#FBBF24'
  if (v < 75) return '#F97316'
  return '#EF4444'
}
const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }

// Decodes Strava's encoded polyline (Google's algorithm) into [lat, lng] pairs.
function decodePolyline(str) {
  let index = 0, lat = 0, lng = 0
  const points = []
  while (index < str.length) {
    let shift = 0, result = 0, byte
    do {
      byte = str.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lat += (result & 1) ? ~(result >> 1) : (result >> 1)

    shift = 0; result = 0
    do {
      byte = str.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lng += (result & 1) ? ~(result >> 1) : (result >> 1)

    points.push([lat / 1e5, lng / 1e5])
  }
  return points
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
          itemStyle={{ color: '#F9FAFB' }}
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
          itemStyle={{ color: '#F9FAFB' }}
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

function StressHourlyChart({ hourly, highlightHour }) {
  if (!hourly) return <p className="text-muted text-xs font-mono">No hourly stress data yet</p>
  const data = hourly.map(h => ({ hour: h.hour, value: h.value }))
  return (
    <ResponsiveContainer width="100%" height={100}>
      <BarChart data={data} barGap={1}>
        <XAxis
          dataKey="hour"
          tickFormatter={(h) => `${h}`}
          tick={{ fontSize: 9, fill: '#6B7280', fontFamily: 'monospace' }}
          axisLine={false} tickLine={false} interval={2}
        />
        <YAxis hide domain={[0, 100]} />
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: '#6B7280' }}
          itemStyle={{ color: '#F9FAFB' }}
          formatter={(v) => [v ?? 'no data', 'Stress']}
          labelFormatter={(h) => `${h}:00`}
        />
        {highlightHour != null && (
          <ReferenceLine x={highlightHour} stroke="#22D3EE" strokeWidth={2} label={{ value: 'activity', position: 'top', fill: '#22D3EE', fontSize: 9 }} />
        )}
        <Bar dataKey="value" radius={[2, 2, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={stressColor(d.value)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function RouteSVG({ polyline }) {
  const points = decodePolyline(polyline)
  if (points.length < 2) return null

  const lats = points.map(p => p[0]), lngs = points.map(p => p[1])
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  const pad = 10, w = 400, h = 200
  const scaleX = (maxLng - minLng) ? (w - pad * 2) / (maxLng - minLng) : 1
  const scaleY = (maxLat - minLat) ? (h - pad * 2) / (maxLat - minLat) : 1
  const scale = Math.min(scaleX, scaleY)

  const path = points.map(([lat, lng], i) => {
    const x = pad + (lng - minLng) * scale
    const y = h - pad - (lat - minLat) * scale // flip Y (lat increases north = up)
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
      <path d={path} fill="none" stroke="#F97316" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ActivityRow({ act, onClick }) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 py-3 border-b border-border last:border-0 hover:bg-white/[0.02] transition-colors px-2 -mx-2 rounded cursor-pointer"
    >
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

function NutritionTrend({ week }) {
  const data = (week || []).filter(d => d.total).map(d => ({
    date: dayjs(d.date).format('ddd'),
    protein: d.total.protein,
  }))
  if (!data.length) return <p className="text-muted text-xs font-mono">No weekly data yet</p>
  return (
    <ResponsiveContainer width="100%" height={80}>
      <LineChart data={data}>
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6B7280', fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
        <YAxis hide domain={['auto', 'auto']} />
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: '#6B7280' }}
          itemStyle={{ color: '#F9FAFB' }}
        />
        <Line dataKey="protein" stroke="#4ADE80" strokeWidth={2} dot={{ r: 3, fill: '#4ADE80' }} name="Protein (g)" />
      </LineChart>
    </ResponsiveContainer>
  )
}

function NutritionPanel({ data, loading, error, onRefresh }) {
  const today = data?.today
  const week  = data?.week
  const proteinPct = today ? Math.min(100, (today.total.protein / today.proteinTarget) * 100) : 0

  return (
    <div className="stat-card">
      <span className="section-title">🌱 Nutrition</span>
      {loading ? (
        <span className="text-xs text-muted font-mono animate-pulse">Loading nutrition data...</span>
      ) : error ? (
        <p className="text-xs font-mono text-warn">⚠ {error}</p>
      ) : today ? (
        <div className="space-y-3">
          <div className="flex justify-between items-baseline">
            <span className="text-xs font-mono text-muted">Protein</span>
            <span className="font-mono font-bold" style={{ color: today.proteinStatus === 'on_target' ? '#4ADE80' : today.proteinStatus === 'close' ? '#FBBF24' : '#EF4444' }}>
              {today.total.protein}g / {today.proteinTarget}g
            </span>
          </div>
          <div className="h-2 bg-border rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-good transition-all" style={{ width: `${proteinPct}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1">
            <div className="text-center"><p className="text-xs text-muted font-mono">Calories</p><p className="text-sm font-mono font-bold">{today.total.calories}</p></div>
            <div className="text-center"><p className="text-xs text-muted font-mono">Carbs</p><p className="text-sm font-mono font-bold">{today.total.carbs}g</p></div>
            <div className="text-center"><p className="text-xs text-muted font-mono">Fat</p><p className="text-sm font-mono font-bold">{today.total.fat}g</p></div>
          </div>
          {today.proteinGap > 0 && (
            <p className="text-xs font-mono text-warn">⚠ {today.proteinGap}g protein still needed today</p>
          )}
          <div className="pt-2 border-t border-border space-y-1.5">
            {Object.entries(MEAL_LABELS).map(([key, label]) => (
              <div key={key} className="flex justify-between items-baseline">
                <span className="text-xs font-mono text-muted">{label}</span>
                <span className="text-xs font-mono">{today.meals[key].calories} kcal · {today.meals[key].protein}g protein</span>
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-border">
            <span className="text-xs font-mono text-muted uppercase tracking-widest">Protein — 7 Days</span>
            <NutritionTrend week={week} />
          </div>
          <p className="text-xs font-mono text-muted">Synced {dayjs(today.fetchedAt).format('HH:mm')}</p>
        </div>
      ) : (
        <div className="text-center py-4 space-y-2">
          <p className="text-xs text-muted font-mono">No nutrition data synced yet</p>
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

function MuscleGroupBreakdown({ muscleGroups }) {
  if (!muscleGroups?.breakdown?.length) return <p className="text-xs font-mono text-muted">Not classified yet</p>
  const maxSets = Math.max(...muscleGroups.breakdown.map(g => g.sets))
  return (
    <div className="space-y-2">
      {muscleGroups.breakdown.map(g => (
        <div key={g.group} className="flex items-center gap-3">
          <span className="text-xs font-mono text-muted w-28 truncate">{g.group}</span>
          <div className="flex-1 h-2 bg-border rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(g.sets / maxSets) * 100}%` }} />
          </div>
          <span className="text-xs font-mono text-muted w-14 text-right">{g.sets} sets</span>
        </div>
      ))}
      {muscleGroups.unclassifiedSets > 0 && (
        <p className="text-xs font-mono text-muted">+ {muscleGroups.unclassifiedSets} unclassified — will update once named in Garmin</p>
      )}
    </div>
  )
}

function ActivityDetailModal({ activityId, onClose }) {
  const [detail, setDetail]   = useState(null)
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setDetail(null); setError(null)
    fetch(`/api/activity/${activityId}`)
      .then(r => r.json())
      .then(d => { if (cancelled) return; d.error ? setError(d.error) : setDetail(d) })
      .catch(() => { if (!cancelled) setError('fetch_error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activityId])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const activity = detail?.activity
  const day = detail?.day
  const isRun = activity?.type === 'Run'

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div className="stat-card w-full max-w-2xl my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-2 gap-3">
          <span className="section-title mb-0">{activity?.name || 'Activity'}</span>
          <button onClick={onClose} className="text-muted hover:text-white text-lg leading-none flex-shrink-0">✕</button>
        </div>

        {loading && <div className="py-8 text-center text-xs font-mono text-muted animate-pulse">Loading activity...</div>}
        {error && <p className="text-xs font-mono text-warn">⚠ {error}</p>}

        {activity && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs font-mono text-muted">{dayjs(activity.date).format('ddd DD MMM, HH:mm')}</span>
              {activity.tags.map(tag => (
                <span key={tag} className="pill bg-accent/10 text-accent">#{tag}</span>
              ))}
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              <div><p className="metric-label">Distance</p><p className="metric-value text-base">{activity.distance}km</p></div>
              <div><p className="metric-label">Duration</p><p className="metric-value text-base">{fmtDur(activity.duration)}</p></div>
              {activity.pace && <div><p className="metric-label">Pace</p><p className="metric-value text-base">{fmtPace(activity.pace)}</p></div>}
              {activity.avgHR && (
                <div><p className="metric-label">Avg HR</p><p className="metric-value text-base" style={{ color: hrColor(activity.avgHR) }}>{activity.avgHR}</p></div>
              )}
              {activity.calories > 0 && <div><p className="metric-label">Calories</p><p className="metric-value text-base">{activity.calories}</p></div>}
              {activity.elevation > 0 && <div><p className="metric-label">Elevation</p><p className="metric-value text-base">{activity.elevation}m</p></div>}
            </div>

            {activity.description && (
              <p className="text-xs font-mono text-muted whitespace-pre-line">{activity.description}</p>
            )}

            {activity.photos.length > 0 && (
              <div className="flex gap-2 overflow-x-auto">
                {activity.photos.map((url, i) => (
                  <img key={i} src={url} alt="" className="h-28 rounded-lg object-cover flex-shrink-0" />
                ))}
              </div>
            )}

            {isRun && activity.polyline && (
              <div>
                <span className="section-title">Route</span>
                <RouteSVG polyline={activity.polyline} />
              </div>
            )}

            {isRun && activity.gear && (
              <div className="flex justify-between items-baseline pt-2 border-t border-border">
                <span className="text-xs font-mono text-muted">👟 {activity.gear.name}</span>
                <span className="text-xs font-mono">{activity.gear.distanceKm}km total</span>
              </div>
            )}

            {day?.garmin?.muscleGroups && (
              <div className="pt-2 border-t border-border">
                <span className="section-title">Muscle Groups</span>
                <MuscleGroupBreakdown muscleGroups={day.garmin.muscleGroups} />
              </div>
            )}

            {(day?.garmin || day?.yazio) && (
              <div className="pt-2 border-t border-border">
                <span className="section-title">That Day</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div><p className="metric-label">Sleep</p><p className="text-sm font-mono font-bold">{day.garmin?.sleep?.hours ? `${day.garmin.sleep.hours}h` : '—'}</p></div>
                  <div><p className="metric-label">HRV</p><p className="text-sm font-mono font-bold">{day.garmin?.hrvAvg ? `${day.garmin.hrvAvg}ms` : '—'}</p></div>
                  <div><p className="metric-label">Body Battery</p><p className="text-sm font-mono font-bold">{day.garmin?.bodyBattery?.current ?? '—'}</p></div>
                  <div><p className="metric-label">Protein</p><p className="text-sm font-mono font-bold">{day.yazio?.total?.protein ? `${day.yazio.total.protein}g` : '—'}</p></div>
                </div>
                {day?.garmin?.stressHourly && (
                  <div className="mt-3">
                    <span className="text-xs font-mono text-muted uppercase tracking-widest">Stress that day — cyan line marks this activity</span>
                    <StressHourlyChart hourly={day.garmin.stressHourly} highlightHour={new Date(activity.date).getUTCHours()} />
                  </div>
                )}
                {!day?.garmin && <p className="text-xs font-mono text-muted mt-1">No cached Garmin data for this day (outside the 7-day window)</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Social follow dropdown ─────────────────────────────────────────
// Real brand marks. Strava's is inherently two-tone, so it keeps its own fills;
// Adidas/Garmin use currentColor so SOCIAL_LINKS' per-brand `color` still applies.
function StravaIcon() {
  return (
    <svg viewBox="90.15 26 331.7 460" width="18" height="18">
      <polygon points="226.172,26.001 90.149,288.345 170.29,288.345 226.172,184.036 281.605,288.345 361.116,288.345" fill="#FF5500" />
      <polygon points="361.116,288.345 321.675,367.586 281.605,288.345 220.871,288.345 321.675,485.999 421.851,288.345" fill="#FFAF8A" />
    </svg>
  )
}
function AdidasIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
      <path d="M1.3294 19L0.731323 17.9641L5.06145 15.4641L7.1029 19H1.3294Z" />
      <path d="M15.1858 19H9.4123L5.7935 12.7321L10.1236 10.2321L15.1858 19Z" />
      <path d="M23.2687 19H17.4952L10.8557 7.5L15.1858 5L23.2687 19Z" />
    </svg>
  )
}
function GarminIcon() {
  return (
    <svg viewBox="0 0 32 32" width="18" height="18" fill="currentColor">
      <path d="M29.355 30.229h-26.709c-1.025 0-1.848-0.516-2.26-1.339-0.516-0.812-0.516-1.855 0-2.672l13.355-23.115c0.511-0.817 1.333-1.333 2.26-1.333 1.027 0 1.849 0.516 2.251 1.333l13.364 23.115c0.516 0.823 0.516 1.855 0 2.672-0.417 0.927-1.24 1.339-2.26 1.339z" />
    </svg>
  )
}

const SOCIAL_LINKS = [
  { name: 'Strava', href: 'https://www.strava.com/athletes/144761491', Icon: StravaIcon, color: '#FC4C02' },
  { name: 'Adidas Running', href: 'https://www.runtastic.com/user/266K80YE43JKCA4V', Icon: AdidasIcon, color: '#F9FAFB' },
  { name: 'Garmin', href: 'https://connect.garmin.com/app/profile/b101f0be-080f-4b61-aed1-b1c4a4f673d2', Icon: GarminIcon, color: '#007CC3' },
]

function SocialDropdown() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Follow me"
        aria-expanded={open}
        className="text-muted hover:text-white transition-colors border border-border p-1.5 rounded flex items-center"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" />
          <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 mt-2 bg-panel border border-border rounded-lg p-2 flex gap-1 z-20 whitespace-nowrap">
          {SOCIAL_LINKS.map(({ name, href, Icon, color }) => (
            <a
              key={name}
              href={href}
              target="_blank"
              rel="noreferrer"
              title={`Follow me on ${name}`}
              className="p-2 rounded hover:bg-white/5 transition-colors"
              style={{ color }}
            >
              <Icon />
            </a>
          ))}
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
  const [selectedActivityId, setSelectedActivityId] = useState(null)

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
      if (d.error) { setError(p => ({ ...p, yazio: d.error })); return d }
      setYazio(d)
      setError(p => ({ ...p, yazio: null }))
      return d
    } catch { setError(p => ({ ...p, yazio: 'fetch_error' })); return null }
    finally { setLoading(p => ({ ...p, yazio: false })) }
  }, [])

  // silent=true suppresses the loading/error UI — used for the background
  // auto-refresh-on-visit below, so a stale-data check never flickers the panel.
  const refreshYazio = useCallback(async (silent = false) => {
    if (!silent) setLoading(p => ({ ...p, yazio: true }))
    try {
      const r = await fetch('/api/yazio/refresh', { method: 'POST' })
      const d = await r.json()
      if (r.status === 429) {
        if (!silent) setError(p => ({ ...p, yazio: 'Refreshed recently — try again in a few minutes' }))
        return
      }
      if (d.error) { if (!silent) setError(p => ({ ...p, yazio: d.error })); return }
      setYazio(d)
      setError(p => ({ ...p, yazio: null }))
    } catch { if (!silent) setError(p => ({ ...p, yazio: 'fetch_error' })) }
    finally { if (!silent) setLoading(p => ({ ...p, yazio: false })) }
  }, [])

  useEffect(() => {
    fetchStrava()
    fetchGarmin()
    fetchYazio().then(d => {
      // Auto-pull fresh nutrition data if it's been >2hrs since the last sync
      // (covers the morning/midday/evening checkpoints without needing paid cron).
      const staleMs = 2 * 60 * 60 * 1000
      const fetchedAt = d?.today?.fetchedAt
      if (!fetchedAt || Date.now() - new Date(fetchedAt).getTime() > staleMs) {
        refreshYazio(true)
      }
    })
    setLastRefresh(new Date())
  }, [fetchStrava, fetchGarmin, fetchYazio, refreshYazio])

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
        <header className="border-b border-border px-4 py-3 flex items-center justify-between flex-wrap gap-y-2 sticky top-0 bg-midnight/95 backdrop-blur z-10">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono font-bold text-accent">⚡ NAVJEET'S FITNESS TRACKER</span>
            {athlete && (
              <div className="flex items-center gap-2 border-l border-border pl-3">
                {athlete.avatar && <img src={athlete.avatar} alt="" className="w-6 h-6 rounded-full" />}
                <span className="text-xs font-mono text-muted">{athlete.name}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <SocialDropdown />
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

          {/* Stress — hourly, today */}
          <div className="stat-card">
            <span className="section-title">Stress — Today (Hourly)</span>
            {loading.garmin ? (
              <div className="h-24 flex items-center justify-center">
                <span className="text-xs text-muted font-mono animate-pulse">Loading Garmin data...</span>
              </div>
            ) : (
              <StressHourlyChart hourly={today?.stressHourly} />
            )}
            <p className="text-xs font-mono text-muted mt-2">
              <span className="text-good">■ &lt;25 rest</span> &nbsp;
              <span className="text-warn">■ 25–49 low</span> &nbsp;
              <span style={{ color: '#F97316' }}>■ 50–74 medium</span> &nbsp;
              <span className="text-pulse">■ 75+ high</span>
            </p>
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
                {strava.activities.map(a => (
                  <ActivityRow key={a.id} act={a} onClick={() => setSelectedActivityId(a.id)} />
                ))}
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
            <p className="text-xs font-mono text-muted">Fitness Tracker</p>
          </footer>
        </main>
      </div>

      {selectedActivityId && (
        <ActivityDetailModal activityId={selectedActivityId} onClose={() => setSelectedActivityId(null)} />
      )}
    </>
  )
}
