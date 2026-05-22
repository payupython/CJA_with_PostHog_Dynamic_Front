import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useSSE } from './hooks/useSSE';
import { useAnalytics } from './hooks/useAnalytics';
import { RULES } from './rules';

const SEGMENT_COLOR: Record<string, string> = {
  high_intent:    'bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/60',
  warm_intent:    'bg-orange-500/25 text-orange-200 ring-1 ring-orange-400/60',
  engaged:        'bg-blue-500/25 text-blue-200 ring-1 ring-blue-400/60',
  active_searcher:'bg-violet-500/25 text-violet-200 ring-1 ring-violet-400/60',
  new:            'bg-stone-500/25 text-stone-200 ring-1 ring-stone-400/60',
};


const ACTION_COLOR: Record<string, string> = {
  segment_updated: 'bg-emerald-900/50 text-emerald-200 ring-1 ring-emerald-700/50',
  sse_published:   'bg-blue-900/50 text-blue-200 ring-1 ring-blue-700/50',
  email_sent:      'bg-amber-900/50 text-amber-200 ring-1 ring-amber-700/50',
};

const ACTION_LABEL: Record<string, string> = {
  segment_updated: '✓ segmento',
  sse_published:   '⚡ SSE',
  email_sent:      '✉ email',
};

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function Dashboard() {
  const { events, connected } = useSSE(100);
  const { users, stats, timeline, rulesHistory, loading } = useAnalytics(5000);

  const segmentChanges = events.filter(e => e.type === 'segment_change');
  const liveEvents = events.filter(e => e.type === 'event');
  const totalEvents = timeline.reduce((s, p) => s + p.events, 0);
  const peakEvents = Math.max(...timeline.map(p => p.events), 1);

  return (
    <div className="min-h-screen bg-[#0d0d0f] text-stone-100 p-6 font-mono">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">CJA Dashboard</h1>
          <p className="text-xs text-stone-400 mt-0.5">Customer Journey Analytics · Realtime</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
          <span className="text-xs text-stone-300">{connected ? 'SSE connected' : 'disconnected'}</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Users" value={loading ? '…' : stats?.total_users ?? 0} />
        <StatCard label="Stream Events" value={loading ? '…' : stats?.stream_events ?? 0} />
        <StatCard label="High Intent" value={loading ? '…' : stats?.segments?.high_intent ?? 0} accent="text-emerald-300" />
        <StatCard label="Engaged" value={loading ? '…' : stats?.segments?.engaged ?? 0} accent="text-blue-300" />
      </div>

      {/* Timeline chart */}
      <div className="bg-[#1a1a1d] border border-white/10 rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs font-bold text-stone-300 uppercase tracking-widest">Eventos · Últimos 60 minutos</p>
            <p className="text-[10px] text-stone-500 mt-0.5">{totalEvents} eventos · pico {peakEvents}/min</p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={timeline} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
            <defs>
              <linearGradient id="evGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 9, fill: '#6b7280' }}
              tickLine={false}
              axisLine={false}
              interval={9}
            />
            <YAxis
              tick={{ fontSize: 9, fill: '#6b7280' }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{ background: '#1f2023', border: '1px solid #ffffff15', borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: '#d1d5db' }}
              itemStyle={{ color: '#10b981' }}
            />
            <Area
              type="monotone"
              dataKey="events"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#evGrad)"
              dot={false}
              activeDot={{ r: 3, fill: '#10b981' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Users */}
        <div className="space-y-3">
          <SectionTitle>Users · Redis State</SectionTitle>
          {loading && <Placeholder />}
          {!loading && users.length === 0 && <Empty>No users yet.</Empty>}
          {users.map(u => (
            <div key={u.userId} className="bg-[#1a1a1d] border border-white/10 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-stone-300 truncate max-w-[150px]" title={u.userId}>{u.userId}</span>
                {u.segment && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SEGMENT_COLOR[u.segment] || 'bg-stone-600 text-stone-100'}`}>
                    {u.segment}
                  </span>
                )}
              </div>
              {u.intent_score && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-stone-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-400 rounded-full transition-all duration-500"
                      style={{ width: `${Math.round(parseFloat(u.intent_score) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-stone-300 font-medium w-8 text-right">{Math.round(parseFloat(u.intent_score) * 100)}%</span>
                </div>
              )}
              {u.counters && Object.keys(u.counters).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(u.counters).map(([k, v]) => (
                    <span key={k} className="text-[9px] bg-stone-700 text-stone-200 px-1.5 py-0.5 rounded font-medium">
                      {k}: <span className="text-white font-bold">{v}</span>
                    </span>
                  ))}
                </div>
              )}
              {u.sites && u.sites.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {u.sites.map(s => (
                    <span key={s} className="text-[9px] bg-amber-900/40 text-amber-200 ring-1 ring-amber-700/40 px-1.5 py-0.5 rounded">
                      🎭 {s}
                    </span>
                  ))}
                </div>
              )}
              {u.last_event_name && (
                <p className="text-[10px] text-stone-400">last: <span className="text-stone-300">{u.last_event_name}</span></p>
              )}
            </div>
          ))}
        </div>

        {/* Rules Engine */}
        <div className="space-y-3">
          <SectionTitle>Rules Engine · Definiciones</SectionTitle>
          <div className="space-y-2">
            {RULES.map(rule => {
              const triggeredLive = segmentChanges.some(e => e.data.rule === rule.id);
              const triggeredRedis = users.some(u => u.segment === rule.segment);
              const triggered = triggeredLive || triggeredRedis;
              const triggerCount = rulesHistory.filter(h => h.rule_id === rule.id).length;
              return (
                <div key={rule.id} className={`bg-[#1a1a1d] border rounded-lg p-3 transition-all ${triggered ? 'border-emerald-400/60' : 'border-white/10'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-white">{rule.name}</span>
                    <div className="flex items-center gap-1.5">
                      {triggerCount > 0 && (
                        <span className="text-[9px] bg-stone-700 text-stone-300 px-1.5 py-0.5 rounded-full font-bold">×{triggerCount}</span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${triggered ? 'bg-emerald-500/30 text-emerald-200 ring-1 ring-emerald-400/50' : 'bg-stone-700 text-stone-300'}`}>
                        {triggered ? 'FIRED' : 'waiting'}
                      </span>
                    </div>
                  </div>
                  <div className="text-[10px] text-stone-400 space-y-0.5">
                    <p>counter: <span className="text-stone-200">{rule.counterKey}</span> ≥ <span className="text-amber-300 font-bold">{rule.threshold}</span></p>
                    <p>segment: <span className="text-stone-200">{rule.segment}</span> · score: <span className="text-emerald-300 font-bold">{rule.score}</span></p>
                    <p>window: <span className="text-stone-300">{rule.windowSeconds / 60}min</span></p>
                  </div>
                </div>
              );
            })}
          </div>

          <SectionTitle>Segment Changes · Live SSE</SectionTitle>
          {segmentChanges.length === 0 && <Empty>Sin cambios en esta sesión.</Empty>}
          {segmentChanges.map(e => (
            <div key={e.id} className="bg-[#1a1a1d] border-l-2 border-l-emerald-400 border border-white/10 rounded-r-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-stone-300 truncate max-w-[160px]">{String(e.data.userId)}</span>
                <span className="text-[10px] text-stone-400">{timeAgo(e.timestamp)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SEGMENT_COLOR[String(e.data.segment)] || 'bg-stone-600 text-stone-100'}`}>
                  {String(e.data.segment)}
                </span>
                <span className="text-[10px] text-stone-300">score: <span className="text-emerald-300 font-bold">{String(e.data.score)}</span></span>
              </div>
              {!!e.data.rule && <p className="text-[10px] text-stone-400 mt-1">rule: <span className="text-stone-300">{String(e.data.rule)}</span></p>}
            </div>
          ))}
        </div>

        {/* Rules History + Live stream */}
        <div className="space-y-3">
          <SectionTitle>Live Event Stream</SectionTitle>
          {liveEvents.length === 0 && <Empty>Esperando eventos…</Empty>}
          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
            {liveEvents.map(e => (
              <div key={e.id} className="bg-[#1a1a1d] border-l-2 border-l-stone-500 border border-white/10 rounded-r-lg p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-stone-100">{String(e.data.eventName || e.type)}</span>
                  <span className="text-[9px] text-stone-400">{timeAgo(e.timestamp)}</span>
                </div>
                <p className="text-[9px] text-stone-500 truncate mt-0.5">{String(e.data.userId || '')}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Activaciones — tabla full width */}
      <div className="mt-6 bg-[#1a1a1d] border border-white/10 rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <SectionTitle>Activaciones de Reglas · Historial completo</SectionTitle>
          <span className="text-[10px] text-stone-400">{rulesHistory.length} registros</span>
        </div>

        {rulesHistory.length === 0 && <Empty>Sin activaciones registradas. Las próximas aparecerán aquí en tiempo real.</Empty>}

        {rulesHistory.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-stone-400 font-medium pb-2 pr-4 w-32">Hora</th>
                  <th className="text-left text-stone-400 font-medium pb-2 pr-4">Regla</th>
                  <th className="text-left text-stone-400 font-medium pb-2 pr-4">Usuario</th>
                  <th className="text-left text-stone-400 font-medium pb-2 pr-4">Segmento</th>
                  <th className="text-left text-stone-400 font-medium pb-2 pr-4">Teatros</th>
                  <th className="text-left text-stone-400 font-medium pb-2 pr-4">Trigger</th>
                  <th className="text-left text-stone-400 font-medium pb-2 pr-4">Sesión</th>
                  <th className="text-left text-stone-400 font-medium pb-2">Acciones ejecutadas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rulesHistory.map((h, i) => (
                  <tr key={i} className="hover:bg-white/[0.02] transition">
                    <td className="py-2 pr-4 text-stone-400 whitespace-nowrap">{fmtTime(h.timestamp)}</td>
                    <td className="py-2 pr-4">
                      <span className="text-stone-100 font-medium">{h.rule_name}</span>
                      <span className="text-stone-500 ml-1">· {h.rule_id}</span>
                    </td>
                    <td className="py-2 pr-4 text-stone-300 max-w-[140px] truncate">{h.userId}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SEGMENT_COLOR[h.segment] || 'bg-stone-600 text-stone-100'}`}>
                        {h.segment}
                      </span>
                      <span className="text-emerald-300 ml-2 text-[10px]">{h.score}</span>
                    </td>
                    <td className="py-2 pr-4">
                      {h.sites?.length > 0
                        ? <span className="text-amber-200 text-[10px]">{h.sites.join(', ')}</span>
                        : <span className="text-stone-600">—</span>
                      }
                    </td>
                    <td className="py-2 pr-4 text-stone-400 whitespace-nowrap">
                      {h.counter_value}/{h.threshold} eventos
                    </td>
                    <td className="py-2 pr-4 text-stone-400 whitespace-nowrap">
                      {h.session_seconds != null
                        ? h.session_seconds >= 60
                          ? `${Math.floor(h.session_seconds / 60)}m ${h.session_seconds % 60}s`
                          : `${h.session_seconds}s`
                        : '—'}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {(h.actions || []).map(a => (
                          <span key={a} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${ACTION_COLOR[a] || 'bg-stone-700 text-stone-300'}`}>
                            {ACTION_LABEL[a] || a}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-6 pt-6 border-t border-white/10">
        <a href="/" className="text-xs text-stone-400 hover:text-stone-100 transition">← Back to App</a>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="bg-[#1a1a1d] border border-white/10 rounded-lg p-4">
      <p className="text-[10px] text-stone-400 uppercase tracking-widest mb-1 font-medium">{label}</p>
      <p className={`text-2xl font-bold ${accent || 'text-white'}`}>{value}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold text-stone-300 uppercase tracking-widest pb-1 border-b border-white/10">{children}</p>
  );
}

function Placeholder() {
  return <div className="h-16 bg-[#1a1a1d] border border-white/10 rounded-lg animate-pulse" />;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-stone-400 py-3 text-center">{children}</p>;
}
