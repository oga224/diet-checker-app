import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'
import EvaluationCard from '../../components/EvaluationCard'

function Badge({ val, yes, no }) {
  if (val === null || val === undefined) return <span className="text-gray-300">—</span>
  return val
    ? <span className="text-green-600 font-bold">{yes ?? 'あり'}</span>
    : <span className="text-gray-400">{no ?? 'なし'}</span>
}

export default function ClientHistoryPage() {
  const { id } = useParams()
  const [client, setClient]       = useState(null)
  const [logs, setLogs]           = useState([])
  const [mealLogMap, setMealLogMap] = useState({}) // date → mealLog
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    async function fetchData() {
      const [clientRes, logsRes, mealRes] = await Promise.all([
        supabase.from('clients').select('name, goal_weight').eq('id', id).single(),
        supabase.from('weight_logs').select('*').eq('client_id', id).order('date', { ascending: false }).limit(30),
        supabase.from('meal_logs')
          .select('date, breakfast_photo_url, lunch_photo_url, dinner_photo_url, snack_photo_url')
          .eq('client_id', id).order('date', { ascending: false }).limit(30),
      ])
      if (!clientRes.error) setClient(clientRes.data)
      if (!logsRes.error)   setLogs(logsRes.data ?? [])
      if (!mealRes.error && mealRes.data) {
        const map = {}
        mealRes.data.forEach((m) => { map[m.date] = m })
        setMealLogMap(map)
      }
      setLoading(false)
    }
    fetchData()
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
      </div>
    )
  }

  const chartData = [...logs].reverse().map((l) => ({
    date: format(parseISO(l.date), 'M/d'),
    朝:   l.morning_kg ?? undefined,
    夜:   l.evening_kg ?? undefined,
  }))

  const latestMorning = logs.find((l) => l.morning_kg != null)?.morning_kg
  const firstMorning  = [...logs].reverse().find((l) => l.morning_kg != null)?.morning_kg
  const diff = (latestMorning != null && firstMorning != null)
    ? (latestMorning - firstMorning).toFixed(1)
    : null

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <header className="bg-blue-600 text-white px-5 py-5 shadow-md">
        <div className="flex items-center gap-3 mb-1">
          <Link to={`/client/${id}`} className="text-blue-200 text-2xl leading-none">‹</Link>
          <p className="text-blue-100 text-base">履歴・グラフ</p>
        </div>
        <h1 className="text-2xl font-bold pl-8">
          {client?.name ? `${client.name} さん` : '体重の記録'}
        </h1>
      </header>

      <main className="max-w-md mx-auto px-4 pt-6 space-y-5">
        {/* サマリー */}
        {(diff !== null || client?.goal_weight) && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-sm font-bold text-gray-500 mb-3">記録サマリー</p>
            <div className="grid grid-cols-2 gap-4">
              {diff !== null && (
                <div className="text-center">
                  <p className="text-xs text-gray-400 mb-1">記録期間の増減</p>
                  <p className={`text-3xl font-bold ${Number(diff) < 0 ? 'text-green-500' : 'text-red-400'}`}>
                    {Number(diff) > 0 ? '+' : ''}{diff}<span className="text-base font-normal"> kg</span>
                  </p>
                </div>
              )}
              {latestMorning != null && (
                <div className="text-center">
                  <p className="text-xs text-gray-400 mb-1">最新の朝体重</p>
                  <p className="text-3xl font-bold text-blue-600">
                    {latestMorning}<span className="text-base font-normal"> kg</span>
                  </p>
                </div>
              )}
              {client?.goal_weight && latestMorning != null && (
                <div className="text-center col-span-2">
                  <p className="text-xs text-gray-400 mb-1">目標まで</p>
                  <p className={`text-2xl font-bold ${latestMorning - client.goal_weight <= 0 ? 'text-green-500' : 'text-blue-500'}`}>
                    {latestMorning <= client.goal_weight
                      ? '目標達成！🎉'
                      : `あと ${(latestMorning - client.goal_weight).toFixed(1)} kg`
                    }
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* グラフ */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-500 mb-4">体重グラフ（直近30日）</p>
          {chartData.length === 0 ? (
            <p className="text-center py-8 text-gray-300 text-base">まだ記録がありません</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}`} width={42} />
                <Tooltip formatter={(v) => `${v} kg`} />
                {client?.goal_weight && (
                  <ReferenceLine y={client.goal_weight} stroke="#22c55e" strokeDasharray="4 3"
                    label={{ value: '目標', position: 'right', fontSize: 10, fill: '#22c55e' }} />
                )}
                <Line type="monotone" dataKey="朝" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="夜" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} connectNulls strokeDasharray="5 4" />
              </LineChart>
            </ResponsiveContainer>
          )}
          <div className="flex gap-4 justify-center mt-3 text-sm text-gray-400">
            <span><span className="inline-block w-4 h-0.5 bg-blue-500 mr-1 align-middle" />朝</span>
            <span><span className="inline-block w-4 h-0.5 bg-orange-400 mr-1 align-middle" />夜</span>
            {client?.goal_weight && <span><span className="inline-block w-4 h-0.5 bg-green-500 mr-1 align-middle" />目標</span>}
          </div>
        </div>

        {/* 記録一覧 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-500 mb-4">記録一覧</p>
          {logs.length === 0 ? (
            <p className="text-center py-8 text-gray-300 text-base">まだ記録がありません</p>
          ) : (
            <div className="space-y-6">
              {logs.map((l, i) => {
                const prevKg  = logs[i + 1]?.morning_kg ?? null
                const mealLog = mealLogMap[l.date] ?? null
                return (
                  <div key={l.date} className="border-b border-gray-100 pb-6 last:border-0 last:pb-0">
                    <p className="text-base font-bold text-gray-700 mb-3">
                      {format(parseISO(l.date), 'M月d日 (E)', { locale: ja })}
                    </p>

                    {/* 体重 */}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div className="bg-blue-50 rounded-xl px-3 py-2 text-center">
                        <p className="text-xs text-gray-400">朝</p>
                        <p className="text-lg font-bold text-blue-600">{l.morning_kg != null ? `${l.morning_kg} kg` : '—'}</p>
                      </div>
                      <div className="bg-orange-50 rounded-xl px-3 py-2 text-center">
                        <p className="text-xs text-gray-400">夜</p>
                        <p className="text-lg font-bold text-orange-500">{l.evening_kg != null ? `${l.evening_kg} kg` : '—'}</p>
                      </div>
                    </div>

                    {/* 生活記録 */}
                    <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-sm text-gray-600 px-1 mb-3">
                      {l.water_ml      != null && <span>💧 {l.water_ml} ml</span>}
                      {l.sleep_hours   != null && <span>😴 {l.sleep_hours}h</span>}
                      {l.toilet_count  != null && <span>🚽 {l.toilet_count}回</span>}
                      <span>💩 <Badge val={l.bowel_movement} /></span>
                      <span>🍳 <Badge val={l.ate_breakfast} yes="食べた" no="×" /></span>
                      <span>🍱 <Badge val={l.ate_lunch} yes="食べた" no="×" /></span>
                      <span>🍚 <Badge val={l.ate_dinner} yes="食べた" no="×" /></span>
                      <span>🍰 <Badge val={l.ate_snack} yes="間食あり" no="なし" /></span>
                    </div>

                    {l.comment && (
                      <p className="mb-3 text-sm text-gray-500 bg-gray-50 rounded-xl px-3 py-2">{l.comment}</p>
                    )}

                    {/* 自動評価 */}
                    <EvaluationCard log={l} prevKg={prevKg} mealLog={mealLog} />
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <Link
          to={`/client/${id}/record`}
          className="block w-full bg-blue-600 text-white text-xl font-bold py-5 rounded-2xl shadow-md text-center"
        >
          今日の記録を入力する
        </Link>
      </main>
    </div>
  )
}
