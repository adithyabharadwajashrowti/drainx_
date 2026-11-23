import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip as MapTip } from 'react-leaflet'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, BarChart, Bar, Cell,
} from 'recharts'
import { supabase, send } from './supabase'

const REAL = 'SS-01'
const CENTER = [12.95, 77.63]

function levelColour(r) {
  if (!r) return '#64748b'
  if (r.reason === 'dirty_water_to_drain') return '#a16207'
  if (r.level_pct >= 85) return '#dc2626'
  if (r.level_pct >= 60) return '#f97316'
  if (r.level_pct >= 35) return '#eab308'
  return '#22c55e'
}

const REASON_TEXT = {
  open: 'Recharging groundwater',
  below_threshold: 'Normal',
  first_flush_to_drain: 'First flush → drain',
  dirty_water_to_drain: 'Polluted → drain (aquifer protected)',
  pit_full: 'Recharge pit full',
  dry_run_protect: 'Low water',
  sensor_fault: 'SENSOR FAULT',
  forced_closed: 'Gate held closed',
}

export default function App() {
  const [nodes, setNodes] = useState([])
  const [latest, setLatest] = useState({})        // node_id -> latest reading
  const [history, setHistory] = useState([])      // real node, last 150 readings
  const [run, setRun] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [potholes, setPotholes] = useState([])
  const [roads, setRoads] = useState([])
  const [threshold, setThreshold] = useState(60)
  const [live, setLive] = useState(false)

  // ---------- initial load ----------
  useEffect(() => {
    async function load() {
      const n = await supabase.from('nodes').select('*')
      setNodes(n.data || [])
      const r = await supabase.from('readings').select('*').order('id', { ascending: false }).limit(600)
      const map = {}
      ;(r.data || []).forEach((x) => { if (!map[x.node_id]) map[x.node_id] = x })
      setLatest(map)
      const h = await supabase.from('readings').select('*').eq('node_id', REAL)
        .order('id', { ascending: false }).limit(150)
      setHistory((h.data || []).reverse())
      const ru = await supabase.from('runs').select('*').order('id', { ascending: false }).limit(1)
      setRun(ru.data?.[0] || null)
      const a = await supabase.from('alerts').select('*').order('id', { ascending: false }).limit(15)
      setAlerts(a.data || [])
      const p = await supabase.from('potholes').select('*').order('id', { ascending: false }).limit(200)
      setPotholes(p.data || [])
      const rr = await supabase.from('road_risk').select('*').order('risk', { ascending: false })
      setRoads(rr.data || [])
    }
    load()

    // ---------- live updates ----------
    const ch = supabase.channel('drainx-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'readings' }, ({ new: x }) => {
        setLatest((m) => ({ ...m, [x.node_id]: x }))
        if (x.node_id === REAL) setHistory((h) => [...h.slice(-149), x])
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'runs' }, ({ new: x }) => setRun(x))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' },
        ({ new: x }) => setAlerts((a) => [x, ...a].slice(0, 15)))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'potholes' },
        ({ new: x }) => setPotholes((p) => [x, ...p]))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'road_risk' }, ({ new: x }) =>
        setRoads((rs) => [...rs.filter((r) => r.segment !== x.segment), x].sort((a, b) => b.risk - a.risk)))
      .subscribe((status) => setLive(status === 'SUBSCRIBED'))
    return () => { supabase.removeChannel(ch) }
  }, [])

  // ---------- derived numbers ----------
  const real = latest[REAL]
  const totalLitres = useMemo(
    () => Object.values(latest).reduce((s, r) => s + (r.litres_total || 0), 0), [latest])
  const online = useMemo(() => Object.values(latest).filter(
    (r) => Date.now() - new Date(r.created_at).getTime() < 30000).length, [latest])
  const atRisk = Object.values(latest).filter((r) => r.level_pct >= 60).length
  const rejected = Object.values(latest).filter((r) => r.reason === 'dirty_water_to_drain').length

  const twinChart = useMemo(() => {
    const t = run?.details?.timeline
    if (!t) return []
    const b = t.baseline?.J2 || [], o = t.optimised?.J2 || [], th = t.threshold?.J2 || []
    return b.map((p, i) => ({
      minute: p[0],
      'Today (no DrainX)': p[2],
      'Simple sensor': th[i]?.[2] ?? 0,
      DrainX: o[i]?.[2] ?? 0,
    }))
  }, [run])

  const compare = run ? [
    { name: 'Today', v: run.flood_m3_baseline, c: '#dc2626' },
    { name: 'Simple sensor', v: run.flood_m3_threshold, c: '#f97316' },
    { name: 'DrainX', v: run.flood_m3_optimised, c: '#22c55e' },
  ] : []
  const ffJ2 = run?.details?.risk?.J2?.floods_in_min

  // ---------- actions ----------
  const startMonsoon = () => { send(REAL, 'D:AUTO', 'R:ON'); send('SIM', 'STORM'); send('BRAIN', 'STORM') }
  const stopMonsoon = () => { send(REAL, 'R:OFF'); send('SIM', 'STOP') }

  return (
    <div className="app">
      <header>
        <div>
          <h1>DrainX</h1>
          <p className="sub">Self-learning stormwater network · Bengaluru</p>
        </div>
        <span className={live ? 'pill on' : 'pill'}>{live ? '● LIVE' : '○ connecting'}</span>
      </header>

      <section className="kpis">
        <Kpi label="Litres recharged into groundwater" value={Math.round(totalLitres).toLocaleString('en-IN')} big />
        <Kpi label="Nodes online" value={`${online}/${nodes.length || 21}`} />
        <Kpi label="Flood-risk spots now" value={atRisk} warn={atRisk > 0} />
        <Kpi label="Polluted water blocked" value={rejected} />
        <Kpi label="Flooding cut by digital twin" value={run ? `${run.reduction_pct}%` : '—'} good />
      </section>

      <section className="grid">
        <div className="card map">
          <h2>City network <small>(1 real node + 20 simulated)</small></h2>
          <MapContainer center={CENTER} zoom={12} style={{ height: 420, borderRadius: 12 }}>
            <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {nodes.map((n) => {
              const r = latest[n.id]
              return (
                <CircleMarker key={n.id} center={[n.lat, n.lng]} radius={n.kind === 'real' ? 14 : 8}
                  pathOptions={{ color: n.kind === 'real' ? '#fff' : levelColour(r), fillColor: levelColour(r),
                    fillOpacity: 0.85, weight: n.kind === 'real' ? 3 : 1 }}>
                  <MapTip>{n.name}</MapTip>
                  <Popup>
                    <b>{n.name}</b><br />
                    Water level: {r?.level_pct ?? '—'}%<br />
                    Recharge pit: {r?.pit_pct ?? '—'}%<br />
                    Gate: {r?.gate_open ? 'OPEN' : 'closed'} — {REASON_TEXT[r?.reason] || r?.reason}<br />
                    Litres recharged: {Math.round(r?.litres_total || 0).toLocaleString('en-IN')}
                  </Popup>
                </CircleMarker>
              )
            })}
            {potholes.map((p) => (
              <CircleMarker key={'p' + p.id} center={[p.lat, p.lng]} radius={4}
                pathOptions={{ color: '#000', fillColor: '#111', fillOpacity: 1 }}>
                <MapTip>Pothole ({Math.round(p.confidence * 100)}%)</MapTip>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>

        <div className="card">
          <h2>Control room</h2>
          <div className="btns">
            <button className="primary" onClick={startMonsoon}>🌧️ Start Monsoon</button>
            <button onClick={stopMonsoon}>Stop rain</button>
          </div>
          <label>Gate threshold: <b>{threshold}%</b></label>
          <input type="range" min="10" max="90" value={threshold}
            onChange={(e) => setThreshold(+e.target.value)}
            onMouseUp={() => send(REAL, `T:${threshold}`)} onTouchEnd={() => send(REAL, `T:${threshold}`)} />
          <div className="btns">
            <button onClick={() => send(REAL, 'D:AUTO')}>Auto</button>
            <button onClick={() => send(REAL, 'D:ON')}>Open gate</button>
            <button onClick={() => send(REAL, 'D:OFF')}>Close gate</button>
          </div>
          <div className="btns">
            <button onClick={() => send('BRAIN', 'STORM')}>Run twin forecast</button>
            <button onClick={() => send('SIM', 'RESET')}>Reset city</button>
          </div>

          <h3>Silk Board node (real hardware)</h3>
          {real ? (
            <div className="facts">
              <Fact k="Water level" v={`${real.level_pct}%`} />
              <Fact k="Recharge pit" v={`${real.pit_pct}%`} />
              <Fact k="Flow" v={`${real.flow_lpm} L/min`} />
              <Fact k="Turbidity (raw)" v={real.turbidity} />
              <Fact k="TDS" v={`${real.tds} ppm`} />
              <Fact k="Soil moisture" v={`${real.soil_pct}%`} />
              <Fact k="Water quality" v={real.quality_ok ? '✅ clean' : '⚠️ dirty'} />
              <Fact k="Gate" v={real.gate_open ? '🟦 OPEN' : 'closed'} />
              <p className="reason">{REASON_TEXT[real.reason] || real.reason}</p>
            </div>
          ) : <p className="muted">Waiting for the node… is bridge.py running?</p>}
        </div>

        <div className="card wide">
          <h2>Live water level — Silk Board node</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={history.map((r) => ({
              t: new Date(r.created_at).toLocaleTimeString('en-IN', { minute: '2-digit', second: '2-digit' }),
              level: r.level_pct, pit: r.pit_pct, gate: r.gate_open ? 100 : 0 }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="t" stroke="#94a3b8" minTickGap={30} />
              <YAxis domain={[0, 100]} stroke="#94a3b8" unit="%" />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
              <Legend />
              <Line dataKey="level" name="Drain level" stroke="#38bdf8" dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line dataKey="pit" name="Recharge pit" stroke="#22c55e" dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line dataKey="gate" name="Gate open" stroke="#a78bfa" dot={false} strokeDasharray="4 4" type="stepAfter" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card wide">
          <h2>Digital twin forecast {run && <small>({run.scenario}, {run.rain_total_mm} mm rain)</small>}</h2>
          {run ? (
            <>
              <p className="headline">
                {ffJ2 != null
                  ? <>Flood predicted at <b>Silk Board</b> in <b>{ffJ2} min</b> — DrainX cuts flooding by <b>{run.reduction_pct}%</b></>
                  : <>No flooding predicted · harvesting rainwater ({run.captured_m3} m³ captured)</>}
              </p>
              <div className="twin">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={twinChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="minute" stroke="#94a3b8" unit=" min" />
                    <YAxis stroke="#94a3b8" unit=" L/s" />
                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
                    <Legend />
                    <Line dataKey="Today (no DrainX)" stroke="#dc2626" dot={false} strokeWidth={2} />
                    <Line dataKey="Simple sensor" stroke="#f97316" dot={false} strokeWidth={2} />
                    <Line dataKey="DrainX" stroke="#22c55e" dot={false} strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={compare}>
                    <XAxis dataKey="name" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" unit=" m³" />
                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
                    <Bar dataKey="v" name="Flood water on roads">
                      {compare.map((d) => <Cell key={d.name} fill={d.c} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : <p className="muted">No forecast yet… is brain.py running?</p>}
        </div>

        <div className="card">
          <h2>Road damage risk</h2>
          <table>
            <thead><tr><th>Road</th><th>Floods</th><th>Potholes</th><th>Risk</th></tr></thead>
            <tbody>
              {roads.map((r) => (
                <tr key={r.segment}>
                  <td>{r.name}</td>
                  <td>{Math.round(r.flood_score * 100)}%</td>
                  <td>{r.pothole_count}</td>
                  <td><span className={'tag ' + r.label}>{r.label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!roads.length && <p className="muted">Start road_risk.py to fill this.</p>}
        </div>

        <div className="card">
          <h2>Live alerts</h2>
          <ul className="alerts">
            {alerts.map((a) => (
              <li key={a.id}>
                <span>{new Date(a.created_at).toLocaleTimeString('en-IN')}</span> {a.message}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}

function Kpi({ label, value, big, warn, good }) {
  return (
    <div className={'kpi' + (big ? ' big' : '') + (warn ? ' warn' : '') + (good ? ' good' : '')}>
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  )
}

function Fact({ k, v }) {
  return <div className="fact"><span>{k}</span><b>{v}</b></div>
}
