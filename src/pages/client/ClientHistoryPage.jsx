import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { format, parseISO, subDays } from 'date-fns'
import { ja } from 'date-fns/locale'
import { supabase }     from '../../lib/supabase'
import EvaluationCard   from '../../components/EvaluationCard'

// ── ミニグラフ（スマホ向け縦スタック） ───────────────────────
function MiniChart({ data, dataKey, label, color, unit = '', yDomain }) {
  if (!data.some(d => d[dataKey] != null)) return null
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <p className="text-sm font-bold text-gray-600 mb-3">{label}</p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis domain={yDomain ?? ['auto', 'auto']} tick={{ fontSize: 10 }}
            tickFormatter={(v) => `${v}${unit}`} width={36} />
          <Tooltip formatter={(v) => `${v}${unit}`} />
          <Line type="monotone" dataKey={dataKey} stroke={color}
            strokeWidth={2.5} dot={{ r: 2 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

const PERIODS = [
  { key: 7,  label: '7日' },
  { key: 14, label: '14日' },
  { key: 30, label: '30日' },
]

export default function ClientHistoryPage() {
  const { id } = useParams()
  const [client, setClient]           = useState(null)
  const [logs, setLogs]               = useState([])
  const [mealLogMap, setMealLogMap]   = useState({})
  const [loading, setLoading]         = useState(true)
  const [period, setPeriod]           = useState(14)

  useEffect(() => {
    async function fetchData() {
      const [cr, lr, mr] = await Promise.all([
        supabase.from('clients').select('name, goal_weight').eq('id', id).single(),
        supabase.from('weight_logs').select('*').eq('client_id', id)
          .order('date', { ascending: false }).limit(60),
        supabase.from('meal_logs')
          .select('date, breakfast_photo_url, lunch_photo_url, dinner_photo_url, snack_photo_url')
          .eq('client_id', id).order('date', { ascending: false }).limit(60),
      ])
      if (!cr.error) setClient(cr.data)
      if (!lr.error) setLogs(lr.data ?? [])
      if (!mr.error && mr.data) {
        const map = {}; mr.data.forEach(m => { map[m.date] = m })
        setMealLogMap(map)
      }
      setLoading(false)
    }
    fetchData()
  }, [id])

  if (loading) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )

  // 期間フィルタ（昇順で並べ直す）
  const cutoff    = format(subDays(new Date(), period), 'yyyy-MM-dd')
  const filtered  = [...logs].reverse().filter(l => l.date >= cutoff)

  // グラフデータ
  const chartData = filtered.map(l => ({
    date:   format(parseISO(l.date), 'M/d'),
    朝体重:  l.morning_kg ?? undefined,
    夜体重:  l.evening_kg ?? undefined,
    朝夜差:  (l.morning_kg != null && l.evening_kg != null)
             ? +(l.evening_kg - l.morning_kg).toFixed(1) : undefined,
    水分量:  l.water_ml ?? undefined,
    睡眠:   l.sleep_hours ?? undefined,
    トイレ:  l.toilet_count ?? undefined,
  }))

  // サマリー
  const latestKg = logs.find(l => l.morning_kg != null)?.morning_kg
  const firstKg  = [...logs].reverse().find(l => l.morning_kg != null)?.morning_kg
  const diff     = (latestKg != null && firstKg != null) ? +(latestKg - firstKg).toFixed(1) : null

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <header className="bg-blue-600 text-white px-5 py-5 shadow-md">
        <div className="flex items-center gap-3 mb-1">
          <Link to={`/client/${id}`} className="text-blue-200 text-2xl">‹</Link>
          <p className="text-blue-100 text-base">履歴・グラフ</p>
        </div>
        <h1 className="text-2xl font-bold pl-8">
          {client?.name ? `${client.name} さん` : '記録履歴'}
        </h1>
      </header>

      <main className="max-w-md mx-auto px-4 pt-5 space-y-4">

        {/* サマリー */}
        {(diff !== null || client?.goal_weight) && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="grid grid-cols-2 gap-4">
              {diff !== null && (
                <div className="text-center">
                  <p className="text-xs text-gray-400 mb-1">全期間の増減</p>
                  <p className={`text-3xl font-bold ${diff < 0 ? 'text-green-500' : 'text-red-400'}`}>
                    {diff > 0 ? '+' : ''}{diff}<span className="text-base font-normal"> kg</span>
                  </p>
                </div>
              )}
              {latestKg != null && (
                <div className="text-center">
                  <p className="text-xs text-gray-400 mb-1">最新の朝体重</p>
                  <p className="text-3xl font-bold text-blue-600">
                    {latestKg}<span className="text-base font-normal"> kg</span>
                  </p>
                </div>
              )}
              {client?.goal_weight && latestKg != null && (
                <div className="text-center col-span-2">
                  <p className={`text-xl font-bold ${latestKg <= client.goal_weight ? 'text-green-500' : 'text-blue-500'}`}>
                    {latestKg <= client.goal_weight
                      ? '目標達成！🎉'
                      : `目標まであと ${(latestKg - client.goal_weight).toFixed(1)} kg`}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 期間切り替え */}
        <div className="flex gap-2">
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`flex-1 py-3 rounded-xl text-base font-bold transition-colors
                ${period === p.key ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'}`}>
              {p.label}
            </button>
          ))}
        </div>

        {chartData.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center text-gray-300">
            この期間の記録がありません
          </div>
        ) : (
          <>
            {/* 体重グラフ（朝・夜） */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-sm font-bold text-gray-600 mb-3">⚖️ 体重の推移</p>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }}
                    tickFormatter={v => `${v}`} width={36} />
                  <Tooltip formatter={v => `${v} kg`} />
                  {client?.goal_weight && (
                    <ReferenceLine y={client.goal_weight} stroke="#22c55e" strokeDasharray="4 3"
                      label={{ value: '目標', position: 'right', fontSize: 9, fill: '#22c55e' }} />
                  )}
                  <Line type="monotone" dataKey="朝体重" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="夜体重" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} connectNulls strokeDasharray="5 4" />
                </LineChart>
              </ResponsiveContainer>
              <div className="flex gap-4 justify-center mt-2 text-xs text-gray-400">
                <span><span className="inline-block w-4 h-0.5 bg-blue-500 mr-1 align-middle" />朝</span>
                <span><span className="inline-block w-4 h-0.5 bg-orange-400 mr-1 align-middle" />夜</span>
              </div>
            </div>

            {/* 朝夜差 */}
            <MiniChart data={chartData} dataKey="朝夜差" label="📊 朝→夜の差（体重増加）"
              color="#8b5cf6" unit="kg" />

            {/* 水分量 */}
            <MiniChart data={chartData} dataKey="水分量" label="💧 水分量の推移"
              color="#06b6d4" unit="mL" />

            {/* 睡眠 */}
            <MiniChart data={chartData} dataKey="睡眠" label="😴 睡眠時間の推移"
              color="#6366f1" unit="h" />

            {/* トイレ */}
            <MiniChart data={chartData} dataKey="トイレ" label="🚽 トイレ回数の推移"
              color="#84cc16" unit="回" />
          </>
        )}

        {/* 記録一覧 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-500 mb-4">記録一覧</p>
          {logs.length === 0 ? (
            <p className="text-center py-8 text-gray-300">まだ記録がありません</p>
          ) : (
            <div className="space-y-5">
              {logs.map((l, i) => {
                const prevKg  = logs[i + 1]?.morning_kg ?? null
                const mealLog = mealLogMap[l.date] ?? null
                return (
                  <div key={l.date} className="border-b border-gray-100 pb-5 last:border-0 last:pb-0">
                    <p className="text-base font-bold text-gray-700 mb-2">
                      {format(parseISO(l.date), 'M月d日 (E)', { locale: ja })}
                    </p>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div className="bg-blue-50 rounded-xl px-3 py-2 text-center">
                        <p className="text-xs text-gray-400">朝</p>
                        <p className="text-lg font-bold text-blue-600">{l.morning_kg != null ? `${l.morning_kg} kg` : '—'}</p>
                      </div>
                      <div className="bg-orange-50 rounded-xl px-3 py-2 text-center">
                        <p className="text-xs text-gray-400">夜</p>
                        <p className="text-lg font-bold text-orange-500">{l.evening_kg != null ? `${l.evening_kg} kg` : '—'}</p>
                      </div>
                    </div>
                    {l.comment && (
                      <p className="mb-2 text-sm text-gray-500 bg-gray-50 rounded-xl px-3 py-2">{l.comment}</p>
                    )}
                    <EvaluationCard log={l} prevKg={prevKg} mealLog={mealLog} />
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <Link to={`/client/${id}/record`}
          className="block w-full bg-blue-600 text-white text-xl font-bold py-5 rounded-2xl shadow-md text-center">
          今日の記録を入力する
        </Link>
      </main>
    </div>
  )
}
