import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import BackButton from '../../components/BackButton'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { format, parseISO, subDays, getDaysInMonth } from 'date-fns'
import { ja } from 'date-fns/locale'
import { supabase }    from '../../lib/supabase'
import EvaluationCard  from '../../components/EvaluationCard'

// ── 月移動ヘルパー ─────────────────────────────────────────
function addM(y, m, d) {
  let nm = m + d, ny = y
  if (nm > 12) { nm -= 12; ny++ }
  if (nm < 1)  { nm += 12; ny-- }
  return { year: ny, month: nm }
}
function pad(n) { return String(n).padStart(2, '0') }

const DOW = ['日','月','火','水','木','金','土']

// ── 表1の行定義（管理画面と同じルール） ─────────────────────
const HEALTH_ROWS = [
  { key: 'morning_kg', label: '朝体重',
    cell: (w) => w?.morning_kg != null ? { v: `${w.morning_kg}`, c: 'text-gray-900' } : { v: '', c: '' } },
  { key: 'evening_kg', label: '夜体重',
    cell: (w) => w?.evening_kg != null ? { v: `${w.evening_kg}`, c: 'text-gray-900' } : { v: '', c: '' } },
  { key: 'weight_diff', label: '朝→夜差',
    cell: (w) => {
      if (!w?.morning_kg || !w?.evening_kg) return { v: '', c: '' }
      const d = +(w.evening_kg - w.morning_kg).toFixed(1)
      return { v: `${d >= 0 ? '+' : ''}${d}`, c: d >= 0.6 ? 'text-red-500 font-bold' : 'text-green-600 font-bold' }
    }},
  { key: 'eating_out', label: '外食',
    cell: (w) => {
      const p = []
      if (w?.ate_out_breakfast) p.push('M')
      if (w?.ate_out_lunch)     p.push('L')
      if (w?.ate_out_dinner)    p.push('D')
      return p.length ? { v: p.join(''), c: 'text-orange-600 font-medium' } : { v: '', c: '' }
    }},
  { key: 'menstruation', label: '生理',
    cell: (w) => w?.menstruation === true ? { v: '○', c: 'text-pink-500' } : { v: '', c: '' } },
  { key: 'bowel', label: '排便',
    cell: (w) => w?.bowel_movement === true ? { v: '○', c: 'text-gray-900' } : { v: '', c: '' } },
  { key: 'water', label: '水分量',
    cell: (w) => {
      if (w?.water_ml == null) return { v: '', c: '' }
      // 100000以上は誤って1000倍された値と判断して補正（例: 1300000 → 1300ml）
      const ml = w.water_ml >= 100000 ? Math.round(w.water_ml / 1000) : w.water_ml
      return { v: `${(ml / 1000).toFixed(1)}L`, c: ml >= 1500 ? 'text-gray-900' : 'text-red-500 font-bold' }
    }},
  { key: 'toilet', label: 'トイレ',
    cell: (w) => w?.toilet_count != null
      ? { v: `${w.toilet_count}回`, c: w.toilet_count >= 10 ? 'text-gray-900' : 'text-red-500 font-bold' }
      : { v: '', c: '' } },
  { key: 'sleep', label: '睡眠',
    cell: (w) => w?.sleep_hours != null
      ? { v: `${w.sleep_hours}h`, c: w.sleep_hours >= 5.5 ? 'text-gray-900' : 'text-red-500 font-bold' }
      : { v: '', c: '' } },
]

// ── 患者向け体調・生活記録表 ─────────────────────────────────
function PatientHealthTable({ clientId }) {
  const navigate = useNavigate()
  const now      = new Date()
  const todayStr = format(now, 'yyyy-MM-dd')
  const nowYM    = format(now, 'yyyy-MM')

  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [wMap,  setWMap]  = useState({})
  const [loading, setLoading] = useState(false)
  const scrollRef    = useRef(null)
  const autoScrolled = useRef(false)

  // 月変更でauto-scrollリセット
  useEffect(() => { autoScrolled.current = false }, [year, month])

  useEffect(() => {
    async function fetchMonth() {
      setLoading(true)
      const mm  = pad(month)
      const end = `${year}-${mm}-${pad(getDaysInMonth(new Date(year, month - 1)))}`
      const { data } = await supabase.from('weight_logs').select('*')
        .eq('client_id', clientId).gte('date', `${year}-${mm}-01`).lte('date', end)
      const wm = {}; (data ?? []).forEach(l => { wm[l.date] = l })
      setWMap(wm); setLoading(false)
    }
    fetchMonth()
  }, [clientId, year, month])

  // データ読み込み後に今日の列へ自動スクロール
  useEffect(() => {
    if (loading || autoScrolled.current) return
    setTimeout(() => {
      const ref = scrollRef.current
      if (!ref) return
      const todayEl = ref.querySelector('[data-today="true"]')
      if (todayEl) {
        const stickyWidth = 64 // min-w-[4rem]
        ref.scrollLeft = Math.max(0, todayEl.offsetLeft - stickyWidth)
      }
      autoScrolled.current = true
    }, 60)
  }, [loading])

  const days  = Array.from({ length: getDaysInMonth(new Date(year, month - 1)) }, (_, i) => i + 1)
  const curYM = `${year}-${pad(month)}`

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* ヘッダー */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-600">📋 体調・生活記録</h2>
        <div className="flex items-center gap-1.5">
          <button onClick={() => { const n = addM(year, month, -1); setYear(n.year); setMonth(n.month) }}
            className="w-8 h-8 rounded-full border border-gray-200 text-lg flex items-center justify-center hover:bg-gray-50 active:scale-95">‹</button>
          <span className="text-xs font-bold text-gray-700 w-16 text-center">{year}年{month}月</span>
          <button onClick={() => { const n = addM(year, month, 1); setYear(n.year); setMonth(n.month) }}
            disabled={curYM >= nowYM}
            className="w-8 h-8 rounded-full border border-gray-200 text-lg flex items-center justify-center hover:bg-gray-50 active:scale-95 disabled:opacity-30">›</button>
        </div>
      </div>

      {/* テーブル */}
      {loading ? (
        <div className="flex justify-center py-6">
          <div className="w-6 h-6 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto" ref={scrollRef}>
          <table className="border-collapse text-xs" style={{ minWidth: `${days.length * 48 + 64}px` }}>
            <thead>
              <tr>
                {/* 左固定 */}
                <th className="sticky left-0 z-20 bg-gray-50 text-left text-gray-400 font-medium
                  px-2 py-2 border-r border-b border-gray-200 min-w-[4rem]">
                  項目
                </th>
                {days.map(d => {
                  const dateStr = `${year}-${pad(month)}-${pad(d)}`
                  const isToday  = dateStr === todayStr
                  const isFuture = dateStr > todayStr
                  const dow = DOW[new Date(year, month - 1, d).getDay()]
                  const isWE  = [0, 6].includes(new Date(year, month - 1, d).getDay())
                  const hasDat = !!wMap[dateStr]
                  return (
                    <th key={d}
                      data-today={isToday ? 'true' : undefined}
                      onClick={() => { if (!isFuture) navigate(`/client/${clientId}/record/${dateStr}`) }}
                      className={[
                        'text-center px-0.5 py-1.5 border-b min-w-[3rem]',
                        !isFuture ? 'cursor-pointer active:opacity-60' : '',
                        isToday
                          ? 'bg-yellow-200 border-b-2 border-b-yellow-500 text-yellow-800 font-bold'
                          : hasDat ? 'bg-gray-50/60 border-b border-gray-200' : 'border-b border-gray-200',
                        !isToday && isWE && !isFuture ? 'text-red-400' : '',
                        !isToday && !isWE && !isFuture ? 'text-gray-700' : '',
                        isFuture ? 'text-gray-200' : '',
                      ].join(' ')}
                    >
                      <div className="font-medium text-xs leading-none">{d}</div>
                      <div className={`text-[10px] leading-none mt-0.5 ${isToday ? 'text-yellow-600' : 'text-gray-400'}`}>{dow}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {HEALTH_ROWS.map((row, ri) => (
                <tr key={row.key} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}>
                  <td className={`sticky left-0 z-10 px-2 py-2 text-xs font-medium text-gray-600
                    border-r border-gray-200 whitespace-nowrap
                    ${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                    {row.label}
                  </td>
                  {days.map(d => {
                    const dateStr = `${year}-${pad(month)}-${pad(d)}`
                    const isToday = dateStr === todayStr
                    const { v, c } = row.cell(wMap[dateStr] ?? null)
                    return (
                      <td key={d} className={`text-center px-0.5 py-1.5 border-b border-gray-100 text-xs ${c} ${isToday ? 'bg-yellow-50' : ''}`}>
                        {v}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 凡例 */}
      <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400 leading-relaxed">
        <span className="text-red-500 font-medium">赤字</span>＝朝夜差+0.6kg以上・水分1.4L以下・トイレ9回以下・睡眠5時間以下
        　<span className="text-green-600 font-medium">緑字</span>＝朝夜差+0.5kg以内
        　日付をタップして編集できます
      </div>
    </div>
  )
}

// ── メインコンポーネント ──────────────────────────────────────
const PERIODS = [
  { key: 7,  label: '7日' },
  { key: 14, label: '14日' },
  { key: 30, label: '30日' },
]

export default function ClientHistoryPage() {
  const { id } = useParams()
  const [client, setClient]       = useState(null)
  const [logs, setLogs]           = useState([])
  const [mealLogMap, setMealLogMap] = useState({})
  const [loading, setLoading]     = useState(true)
  const [period, setPeriod]       = useState(14)

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
        const map = {}; mr.data.forEach(m => { map[m.date] = m }); setMealLogMap(map)
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

  // 期間フィルタ（グラフ用）
  const cutoff   = format(subDays(new Date(), period), 'yyyy-MM-dd')
  const filtered = [...logs].reverse().filter(l => l.date >= cutoff)
  const chartData = filtered.map(l => ({
    date: format(parseISO(l.date), 'M/d'),
    朝体重: l.morning_kg ?? undefined,
    夜体重: l.evening_kg ?? undefined,
  }))

  const latestKg = logs.find(l => l.morning_kg != null)?.morning_kg
  const firstKg  = [...logs].reverse().find(l => l.morning_kg != null)?.morning_kg
  const diff     = (latestKg != null && firstKg != null) ? +(latestKg - firstKg).toFixed(1) : null

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <header className="bg-blue-600 text-white px-5 py-5 shadow-md">
        <div className="flex items-center gap-3 mb-1">
          <BackButton to={`/client/${id}`} label="戻る" variant="light" />
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

        {/* ⚖️ 体重グラフ（朝・夜のみ） */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-sm font-bold text-gray-600 mb-3">⚖️ 体重の推移</p>
          {chartData.length === 0 ? (
            <p className="text-center py-8 text-gray-300">この期間の記録がありません</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }}
                    tickFormatter={v => `${v}`} width={38} />
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
                {client?.goal_weight && <span><span className="inline-block w-4 h-0.5 bg-green-500 mr-1 align-middle" />目標</span>}
              </div>
            </>
          )}
        </div>

        {/* 📋 体調・生活記録表（管理画面と同じ表1） */}
        <PatientHealthTable clientId={id} />

        {/* 記録一覧（最新5件） */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-500 mb-4">最近の記録</p>
          {logs.length === 0 ? (
            <p className="text-center py-8 text-gray-300">まだ記録がありません</p>
          ) : (
            <div className="space-y-5">
              {logs.slice(0, 10).map((l, i) => {
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
                        <p className="text-lg font-bold text-blue-600">
                          {l.morning_kg != null ? `${l.morning_kg} kg` : '—'}
                        </p>
                      </div>
                      <div className="bg-orange-50 rounded-xl px-3 py-2 text-center">
                        <p className="text-xs text-gray-400">夜</p>
                        <p className="text-lg font-bold text-orange-500">
                          {l.evening_kg != null ? `${l.evening_kg} kg` : '—'}
                        </p>
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
