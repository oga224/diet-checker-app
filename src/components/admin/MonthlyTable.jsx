import { useEffect, useState } from 'react'
import { getDaysInMonth, format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { evaluateLog } from '../../lib/evaluateLog'

// ── セル値とクラスを返すロジック ─────────────────────────────
const ROWS = [
  {
    key: 'morning_kg', label: '朝体重',
    cell: (w) => {
      if (!w?.morning_kg) return { v: '—', c: 'text-gray-300' }
      return { v: `${w.morning_kg}`, c: 'text-gray-700' }
    },
  },
  {
    key: 'evening_kg', label: '夜体重',
    cell: (w) => {
      if (!w?.evening_kg) return { v: '—', c: 'text-gray-300' }
      return { v: `${w.evening_kg}`, c: 'text-gray-700' }
    },
  },
  {
    key: 'weight_diff', label: '朝→夜差',
    cell: (w) => {
      if (!w?.morning_kg || !w?.evening_kg) return { v: '—', c: 'text-gray-300' }
      const d = +(w.evening_kg - w.morning_kg).toFixed(1)
      return {
        v: `${d >= 0 ? '+' : ''}${d}`,
        c: d <= 0.5 ? 'text-gray-700' : 'text-red-500 font-bold',
      }
    },
  },
  {
    key: 'bowel', label: '排便',
    cell: (w) => {
      if (w?.bowel_movement === true)  return { v: '○', c: 'text-gray-700' }
      if (w?.bowel_movement === false) return { v: '×', c: 'text-red-500 font-bold' }
      return { v: '—', c: 'text-gray-300' }
    },
  },
  {
    key: 'water', label: '水分量',
    cell: (w) => {
      if (w?.water_ml == null) return { v: '—', c: 'text-gray-300' }
      const ok = w.water_ml >= 1500
      return { v: `${(w.water_ml / 1000).toFixed(1)}L`, c: ok ? 'text-gray-700' : 'text-red-500 font-bold' }
    },
  },
  {
    key: 'toilet', label: 'トイレ',
    cell: (w) => {
      if (w?.toilet_count == null) return { v: '—', c: 'text-gray-300' }
      const ok = w.toilet_count >= 10
      return { v: `${w.toilet_count}回`, c: ok ? 'text-gray-700' : 'text-red-500 font-bold' }
    },
  },
  {
    key: 'sleep', label: '睡眠',
    cell: (w) => {
      if (w?.sleep_hours == null) return { v: '—', c: 'text-gray-300' }
      const ok = w.sleep_hours >= 5.5
      return { v: `${w.sleep_hours}h`, c: ok ? 'text-gray-700' : 'text-red-500 font-bold' }
    },
  },
  {
    key: 'breakfast', label: '朝食',
    cell: (w) => {
      if (w?.ate_breakfast === true)  return { v: '○', c: 'text-gray-700' }
      if (w?.ate_breakfast === false) return { v: '×', c: 'text-gray-400' }
      return { v: '—', c: 'text-gray-300' }
    },
  },
  {
    key: 'lunch', label: '昼食',
    cell: (w) => {
      if (w?.ate_lunch === true)  return { v: '○', c: 'text-gray-700' }
      if (w?.ate_lunch === false) return { v: '×', c: 'text-gray-400' }
      return { v: '—', c: 'text-gray-300' }
    },
  },
  {
    key: 'dinner', label: '夕食',
    cell: (w) => {
      if (w?.ate_dinner === true)  return { v: '○', c: 'text-gray-700' }
      if (w?.ate_dinner === false) return { v: '×', c: 'text-gray-400' }
      return { v: '—', c: 'text-gray-300' }
    },
  },
  {
    key: 'snack', label: '間食',
    cell: (w) => {
      if (w?.ate_snack === false) return { v: 'なし', c: 'text-gray-700' }
      if (w?.ate_snack === true)  return { v: 'あり', c: 'text-orange-500' }
      return { v: '—', c: 'text-gray-300' }
    },
  },
  {
    key: 'photo', label: '写真',
    cell: (_w, m) => {
      const n = m
        ? [m.breakfast_photo_url, m.lunch_photo_url, m.dinner_photo_url, m.snack_photo_url]
            .filter(Boolean).length
        : 0
      if (n === 0) return { v: '—', c: 'text-gray-300' }
      return { v: `${n}枚`, c: 'text-blue-600' }
    },
  },
  {
    key: 'comment', label: 'メモ',
    cell: (w) => {
      if (!w?.comment) return { v: '—', c: 'text-gray-300' }
      return { v: '○', c: 'text-blue-600' }
    },
  },
  {
    key: 'score', label: 'スコア',
    cell: (w, m) => {
      if (!w) return { v: '—', c: 'text-gray-300' }
      const { score } = evaluateLog(w, null, m)
      const c = score >= 90 ? 'text-green-600 font-bold'
              : score >= 70 ? 'text-blue-600 font-bold'
              : 'text-red-500 font-bold'
      return { v: `${score}`, c }
    },
  },
]

// ── 月ナビゲーションヘルパー ─────────────────────────────────
function addMonth(year, month, delta) {
  let m = month + delta
  let y = year
  if (m > 12) { m -= 12; y++ }
  if (m < 1)  { m += 12; y-- }
  return { year: y, month: m }
}

export default function MonthlyTable({ clientId }) {
  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [wMap,  setWMap]  = useState({}) // dateStr → weight_log
  const [mMap,  setMMap]  = useState({}) // dateStr → meal_log
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function fetchMonth() {
      setLoading(true)
      const mm = String(month).padStart(2, '0')
      const days = getDaysInMonth(new Date(year, month - 1))
      const start = `${year}-${mm}-01`
      const end   = `${year}-${mm}-${String(days).padStart(2, '0')}`

      const [wRes, mRes] = await Promise.all([
        supabase.from('weight_logs').select('*')
          .eq('client_id', clientId).gte('date', start).lte('date', end),
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
    const next = addMonth(year, month, delta)
    setYear(next.year); setMonth(next.month)
  }

  const totalDays = getDaysInMonth(new Date(year, month - 1))
  const days = Array.from({ length: totalDays }, (_, i) => i + 1)
  const DOW  = ['日','月','火','水','木','金','土']
  const todayStr = format(new Date(), 'yyyy-MM-dd')

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* ヘッダー */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">月間記録</h2>
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

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                {/* 左固定ヘッダー */}
                <th className="sticky left-0 z-20 bg-gray-50 text-left text-gray-400 font-medium
                  px-3 py-2 border-r border-b border-gray-200 whitespace-nowrap min-w-[5rem]">
                  項目
                </th>
                {/* 日付列 */}
                {days.map(d => {
                  const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
                  const dow     = DOW[new Date(year, month - 1, d).getDay()]
                  const isWE    = new Date(year, month - 1, d).getDay() === 0
                               || new Date(year, month - 1, d).getDay() === 6
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
              {ROWS.map((row, ri) => (
                <tr key={row.key} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}>
                  {/* 行ラベル（左固定） */}
                  <td className={`sticky left-0 z-10 px-3 py-2 font-medium text-gray-500
                    border-r border-gray-200 whitespace-nowrap
                    ${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                    {row.label}
                  </td>
                  {/* データセル */}
                  {days.map(d => {
                    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
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
      )}

      {/* 凡例 */}
      <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
        <span><span className="text-red-500 font-bold">赤字</span> = 基準値未達</span>
        <span>朝→夜差 +0.6kg以上・水分1.4L以下・トイレ9回以下・睡眠5h以下・排便なし</span>
      </div>
    </section>
  )
}
