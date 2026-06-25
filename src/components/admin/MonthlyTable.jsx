import { useEffect, useState } from 'react'
import { getDaysInMonth, format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { evaluateLog } from '../../lib/evaluateLog'

// ── 共通ヘルパー ─────────────────────────────────────────────
function addMonth(y, m, delta) {
  let nm = m + delta, ny = y
  if (nm > 12) { nm -= 12; ny++ }
  if (nm < 1)  { nm += 12; ny-- }
  return { year: ny, month: nm }
}

function pad(n) { return String(n).padStart(2, '0') }

// ── 表1 行定義：体調・生活記録 ───────────────────────────────
const ROWS_HEALTH = [
  {
    key: 'morning_kg', label: '朝体重',
    cell: (w) => w?.morning_kg != null
      ? { v: `${w.morning_kg}`, c: 'text-gray-700' }
      : { v: '', c: '' },
  },
  {
    key: 'evening_kg', label: '夜体重',
    cell: (w) => w?.evening_kg != null
      ? { v: `${w.evening_kg}`, c: 'text-gray-700' }
      : { v: '', c: '' },
  },
  {
    key: 'weight_diff', label: '朝→夜差',
    cell: (w) => {
      if (!w?.morning_kg || !w?.evening_kg) return { v: '', c: '' }
      const d = +(w.evening_kg - w.morning_kg).toFixed(1)
      return {
        v: `${d >= 0 ? '+' : ''}${d}`,
        c: d >= 0.6 ? 'text-red-500 font-bold' : 'text-gray-700',
      }
    },
  },
  {
    key: 'eating_out', label: '外食',
    cell: (w) => {
      const parts = []
      if (w?.ate_out_breakfast) parts.push('M')
      if (w?.ate_out_lunch)     parts.push('L')
      if (w?.ate_out_dinner)    parts.push('D')
      return parts.length > 0
        ? { v: parts.join(''), c: 'text-orange-600 font-medium' }
        : { v: '', c: '' }
    },
  },
  {
    key: 'menstruation', label: '生理',
    cell: (w) => w?.menstruation === true ? { v: '○', c: 'text-pink-500' } : { v: '', c: '' },
  },
  {
    key: 'bowel', label: '排便',
    cell: (w) => {
      if (w?.bowel_movement === true)  return { v: '○', c: 'text-gray-700' }
      if (w?.bowel_movement === false) return { v: '×', c: 'text-red-500 font-bold' }
      return { v: '', c: '' }
    },
  },
  {
    key: 'water', label: '水分量',
    cell: (w) => {
      if (w?.water_ml == null) return { v: '', c: '' }
      const ok = w.water_ml >= 1500
      return { v: `${(w.water_ml / 1000).toFixed(1)}L`, c: ok ? 'text-gray-700' : 'text-red-500 font-bold' }
    },
  },
  {
    key: 'toilet', label: 'トイレ',
    cell: (w) => {
      if (w?.toilet_count == null) return { v: '', c: '' }
      const ok = w.toilet_count >= 10
      return { v: `${w.toilet_count}回`, c: ok ? 'text-gray-700' : 'text-red-500 font-bold' }
    },
  },
  {
    key: 'sleep', label: '睡眠',
    cell: (w) => {
      if (w?.sleep_hours == null) return { v: '', c: '' }
      const ok = w.sleep_hours >= 5.5
      return { v: `${w.sleep_hours}h`, c: ok ? 'text-gray-700' : 'text-red-500 font-bold' }
    },
  },
]

// ── 表2 行定義：食事・記録状況 ───────────────────────────────
const ROWS_MEAL = [
  {
    key: 'breakfast', label: '朝食',
    cell: (w) => {
      if (w?.ate_breakfast === true)  return { v: '○', c: 'text-gray-700' }
      if (w?.ate_breakfast === false) return { v: '×', c: 'text-gray-400' }
      return { v: '', c: '' }
    },
  },
  {
    key: 'lunch', label: '昼食',
    cell: (w) => {
      if (w?.ate_lunch === true)  return { v: '○', c: 'text-gray-700' }
      if (w?.ate_lunch === false) return { v: '×', c: 'text-gray-400' }
      return { v: '', c: '' }
    },
  },
  {
    key: 'dinner', label: '夕食',
    cell: (w) => {
      if (w?.ate_dinner === true)  return { v: '○', c: 'text-gray-700' }
      if (w?.ate_dinner === false) return { v: '×', c: 'text-gray-400' }
      return { v: '', c: '' }
    },
  },
  {
    key: 'snack', label: '間食',
    cell: (w) => {
      if (w?.ate_snack === false) return { v: 'なし', c: 'text-gray-700' }
      if (w?.ate_snack === true)  return { v: 'あり', c: 'text-orange-500' }
      return { v: '', c: '' }
    },
  },
  {
    key: 'photo', label: '写真',
    cell: (_w, m) => {
      const has = m && [
        m.breakfast_photo_url, m.lunch_photo_url,
        m.dinner_photo_url,    m.snack_photo_url,
      ].some(Boolean)
      return has ? { v: '○', c: 'text-blue-600' } : { v: '', c: '' }
    },
  },
  {
    key: 'comment', label: 'メモ',
    cell: (w) => w?.comment ? { v: '○', c: 'text-blue-600' } : { v: '', c: '' },
  },
  {
    key: 'score', label: 'スコア',
    cell: (w, m) => {
      if (!w) return { v: '', c: '' }
      const { score } = evaluateLog(w, null, m)
      const c = score >= 70 ? 'text-blue-700 font-bold'
              : score >= 55 ? 'text-yellow-600 font-bold'
              : 'text-red-500 font-bold'
      return { v: String(score), c }
    },
  },
]

// ── テーブル本体 ─────────────────────────────────────────────
function Table({ rows, days, wMap, mMap, year, month, todayStr }) {
  const DOW = ['日','月','火','水','木','金','土']
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs" style={{ minWidth: `${days.length * 44 + 80}px` }}>
        <thead>
          <tr>
            <th className="sticky left-0 z-20 bg-gray-50 text-left text-gray-400 font-medium
              px-3 py-2 border-r border-b border-gray-200 whitespace-nowrap min-w-[5rem]">
              項目
            </th>
            {days.map(d => {
              const dateStr = `${year}-${pad(month)}-${pad(d)}`
              const dow     = DOW[new Date(year, month - 1, d).getDay()]
              const isWE    = [0, 6].includes(new Date(year, month - 1, d).getDay())
              const isToday = dateStr === todayStr
              const hasDat  = !!wMap[dateStr]
              return (
                <th key={d}
                  className={`text-center px-1 py-1.5 border-b border-gray-200 min-w-[2.8rem]
                    ${isToday  ? 'bg-blue-50 border-b-2 border-b-blue-400' : hasDat ? 'bg-gray-50/60' : ''}
                    ${isWE ? 'text-red-400' : 'text-gray-400'}`}>
                  <div className="font-medium">{d}</div>
                  <div className="text-gray-300">{dow}</div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={row.key} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}>
              <td className={`sticky left-0 z-10 px-3 py-2 font-medium text-gray-500
                border-r border-gray-200 whitespace-nowrap
                ${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                {row.label}
              </td>
              {days.map(d => {
                const dateStr = `${year}-${pad(month)}-${pad(d)}`
                const isToday = dateStr === todayStr
                const { v, c } = row.cell(wMap[dateStr] ?? null, mMap[dateStr] ?? null)
                return (
                  <td key={d}
                    className={`text-center px-1 py-2 border-b border-gray-100 ${c}
                      ${isToday ? 'bg-blue-50/50' : ''}`}>
                    {v}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── メインコンポーネント ──────────────────────────────────────
export default function MonthlyTable({ clientId }) {
  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [wMap,  setWMap]  = useState({})
  const [mMap,  setMMap]  = useState({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function fetchMonth() {
      setLoading(true)
      const mm    = pad(month)
      const days  = getDaysInMonth(new Date(year, month - 1))
      const start = `${year}-${mm}-01`
      const end   = `${year}-${mm}-${pad(days)}`
      const [wRes, mRes] = await Promise.all([
        supabase.from('weight_logs').select('*').eq('client_id', clientId)
          .gte('date', start).lte('date', end),
        supabase.from('meal_logs')
          .select('date, breakfast_photo_url, lunch_photo_url, dinner_photo_url, snack_photo_url')
          .eq('client_id', clientId).gte('date', start).lte('date', end),
      ])
      const wm = {}; (wRes.data ?? []).forEach(l => { wm[l.date] = l })
      const mm2 = {}; (mRes.data ?? []).forEach(l => { mm2[l.date] = l })
      setWMap(wm); setMMap(mm2)
      setLoading(false)
    }
    fetchMonth()
  }, [clientId, year, month])

  function navigate(delta) {
    const n = addMonth(year, month, delta)
    setYear(n.year); setMonth(n.month)
  }

  const totalDays = getDaysInMonth(new Date(year, month - 1))
  const days = Array.from({ length: totalDays }, (_, i) => i + 1)
  const todayStr = format(new Date(), 'yyyy-MM-dd')

  // 月ナビゲーションヘッダー（共通）
  const Nav = (
    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <button onClick={() => navigate(-1)}
          className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors">
          ← 前月
        </button>
        <span className="text-sm font-bold text-gray-700 w-24 text-center">
          {year}年{month}月
        </span>
        <button onClick={() => navigate(1)}
          className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors">
          翌月 →
        </button>
      </div>
    </div>
  )

  const Spinner = (
    <div className="flex justify-center py-8">
      <div className="w-6 h-6 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )

  return (
    <>
      {/* ── 表1：体調・生活記録 ── */}
      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-600">表1：体調・生活記録</h2>
          {Nav}
        </div>
        {loading ? Spinner : (
          <>
            <Table rows={ROWS_HEALTH} days={days} wMap={wMap} mMap={mMap}
              year={year} month={month} todayStr={todayStr} />
            <div className="px-5 py-2.5 border-t border-gray-100 text-xs text-gray-400">
              <span className="text-red-500 font-medium">赤字</span>＝朝→夜差 +0.6kg以上・水分 1.4L以下・トイレ 9回以下・睡眠 5時間以下・排便なし
            </div>
          </>
        )}
      </section>

      {/* ── 表2：食事・記録状況 ── */}
      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-600">表2：食事・記録状況</h2>
        </div>
        {loading ? Spinner : (
          <>
            <Table rows={ROWS_MEAL} days={days} wMap={wMap} mMap={mMap}
              year={year} month={month} todayStr={todayStr} />
            <div className="px-5 py-2.5 border-t border-gray-100 text-xs text-gray-400">
              スコア：<span className="text-green-600 font-medium">70点以上</span>＝良好
              <span className="text-yellow-600 font-medium">55〜69点</span>＝要注意
              <span className="text-red-500 font-medium">54点以下</span>＝要改善
            </div>
          </>
        )}
      </section>
    </>
  )
}
