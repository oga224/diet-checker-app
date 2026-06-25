import { useEffect, useRef, useState } from 'react'
import { getDaysInMonth, format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { evaluateLog } from '../../lib/evaluateLog'

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
    cell: (w) => w?.morning_kg != null ? { v: `${w.morning_kg}`, c: 'text-gray-700' } : { v: '', c: '' },
  },
  {
    key: 'evening_kg', label: '夜体重',
    cell: (w) => w?.evening_kg != null ? { v: `${w.evening_kg}`, c: 'text-gray-700' } : { v: '', c: '' },
  },
  {
    key: 'weight_diff', label: '朝→夜差',
    cell: (w) => {
      if (!w?.morning_kg || !w?.evening_kg) return { v: '', c: '' }
      const d = +(w.evening_kg - w.morning_kg).toFixed(1)
      // +0.6以上 → 赤、それ以外はすべて緑
      const c = d >= 0.6 ? 'text-red-500 font-bold' : 'text-green-600 font-bold'
      return { v: `${d >= 0 ? '+' : ''}${d}`, c }
    },
  },
  {
    key: 'eating_out', label: '外食',
    cell: (w) => {
      const parts = []
      if (w?.ate_out_breakfast) parts.push('M')
      if (w?.ate_out_lunch)     parts.push('L')
      if (w?.ate_out_dinner)    parts.push('D')
      return parts.length > 0 ? { v: parts.join(''), c: 'text-orange-600 font-medium' } : { v: '', c: '' }
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
      return { v: `${(w.water_ml / 1000).toFixed(1)}L`, c: w.water_ml >= 1500 ? 'text-gray-700' : 'text-red-500 font-bold' }
    },
  },
  {
    key: 'toilet', label: 'トイレ',
    cell: (w) => {
      if (w?.toilet_count == null) return { v: '', c: '' }
      return { v: `${w.toilet_count}回`, c: w.toilet_count >= 10 ? 'text-gray-700' : 'text-red-500 font-bold' }
    },
  },
  {
    key: 'sleep', label: '睡眠',
    cell: (w) => {
      if (w?.sleep_hours == null) return { v: '', c: '' }
      return { v: `${w.sleep_hours}h`, c: w.sleep_hours >= 5.5 ? 'text-gray-700' : 'text-red-500 font-bold' }
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
      const has = m && [m.breakfast_photo_url, m.lunch_photo_url, m.dinner_photo_url, m.snack_photo_url].some(Boolean)
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
      const c = score >= 90 ? 'text-blue-600 font-bold'
              : score >= 80 ? 'text-green-600 font-bold'
              : score >= 70 ? 'text-orange-500 font-bold'
              : 'text-red-500 font-bold'
      return { v: String(score), c }
    },
  },
]

// ── テーブル本体（スクロール ref・onScroll 受け取り） ──────────
const DOW = ['日','月','火','水','木','金','土']

function Table({ rows, days, wMap, mMap, year, month, todayStr, scrollRef, onScroll }) {
  return (
    <div className="overflow-x-auto" ref={scrollRef} onScroll={onScroll}>
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
                  data-today={isToday ? 'true' : undefined}
                  className={`text-center px-1 py-1.5 border-b min-w-[2.8rem]
                    ${isToday
                      ? 'bg-yellow-200 border-b-2 border-b-yellow-500 text-yellow-800 font-bold'
                      : hasDat ? 'bg-gray-50/60 border-b border-gray-200' : 'border-b border-gray-200'}
                    ${!isToday && isWE ? 'text-red-400' : !isToday ? 'text-gray-400' : ''}`}>
                  <div className="font-medium">{d}</div>
                  <div className={isToday ? 'text-yellow-600' : 'text-gray-300'}>{dow}</div>
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
                      ${isToday ? 'bg-yellow-50' : ''}`}>
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
  const [year,    setYear]    = useState(now.getFullYear())
  const [month,   setMonth]   = useState(now.getMonth() + 1)
  const [wMap,    setWMap]    = useState({})
  const [mMap,    setMMap]    = useState({})
  const [loading, setLoading] = useState(false)

  // スクロール関連
  const scrollRef1     = useRef(null)
  const scrollRef2     = useRef(null)
  const isSyncing      = useRef(false)
  const userScrolled   = useRef(false)   // 手動スクロール済みフラグ

  // アニメーション関連
  const [slideOut, setSlideOut] = useState(null) // null | 'left' | 'right'
  const navigating = useRef(false)

  const todayStr   = format(new Date(), 'yyyy-MM-dd')
  const nowYear    = now.getFullYear()
  const nowMonth   = now.getMonth() + 1

  // データ取得
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

  // 月変更時：手動スクロールフラグをリセット
  useEffect(() => {
    userScrolled.current = false
  }, [year, month])

  // データ読み込み完了後：今日の列へ自動スクロール
  useEffect(() => {
    if (loading) return
    // 現在の表示月に今日が含まれている場合のみスクロール
    if (year !== nowYear || month !== nowMonth) return
    if (userScrolled.current) return

    setTimeout(() => {
      const ref = scrollRef1.current
      if (!ref) return
      const todayEl = ref.querySelector('[data-today="true"]')
      if (!todayEl) return
      const containerWidth = ref.clientWidth
      const stickyWidth    = 80 // sticky 列の幅
      const targetLeft     = todayEl.offsetLeft - stickyWidth - (containerWidth - stickyWidth) / 2 + todayEl.offsetWidth / 2
      const scrollTo       = Math.max(0, targetLeft)
      ref.scrollLeft = scrollTo
      if (scrollRef2.current) scrollRef2.current.scrollLeft = scrollTo
    }, 80)
  }, [loading, year, month])

  // 同期スクロールハンドラ
  function handleScroll1(e) {
    userScrolled.current = true
    if (isSyncing.current) return
    isSyncing.current = true
    if (scrollRef2.current) scrollRef2.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => { isSyncing.current = false })
  }
  function handleScroll2(e) {
    userScrolled.current = true
    if (isSyncing.current) return
    isSyncing.current = true
    if (scrollRef1.current) scrollRef1.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => { isSyncing.current = false })
  }

  // 月切り替え（スライドアニメーション付き）
  function navigate(delta) {
    if (navigating.current) return
    navigating.current = true
    setSlideOut(delta > 0 ? 'left' : 'right')
    setTimeout(() => {
      const n = addMonth(year, month, delta)
      setYear(n.year); setMonth(n.month)
      setSlideOut(null)
      navigating.current = false
    }, 160)
  }

  const totalDays = getDaysInMonth(new Date(year, month - 1))
  const days = Array.from({ length: totalDays }, (_, i) => i + 1)

  const Nav = (
    <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
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
  )

  const Spinner = (
    <div className="flex justify-center py-8">
      <div className="w-6 h-6 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )

  // スライドアニメーション用スタイル
  const slideStyle = {
    transform:  slideOut === 'left'  ? 'translateX(-16px)'
              : slideOut === 'right' ? 'translateX(16px)'
              : 'translateX(0)',
    opacity:    slideOut ? 0 : 1,
    transition: 'transform 0.16s ease, opacity 0.16s ease',
  }

  return (
    <>
      {/* ── 表1：体調・生活記録 ── */}
      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-600 px-5 py-3">表1：体調・生活記録</h2>
          {Nav}
        </div>
        <div style={slideStyle}>
          {loading ? Spinner : (
            <>
              <Table rows={ROWS_HEALTH} days={days} wMap={wMap} mMap={mMap}
                year={year} month={month} todayStr={todayStr}
                scrollRef={scrollRef1} onScroll={handleScroll1} />
              <div className="px-5 py-2.5 border-t border-gray-100 text-xs text-gray-400">
                <span className="text-red-500 font-medium">赤字</span>＝朝→夜差 +0.6kg以上・水分 1.4L以下・トイレ 9回以下・睡眠 5時間以下・排便なし
                　<span className="text-green-600 font-medium">緑字</span>＝朝→夜差 +0.5kg以内
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── 表2：食事・記録状況 ── */}
      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-600">表2：食事・記録状況</h2>
        </div>
        <div style={slideStyle}>
          {loading ? Spinner : (
            <>
              <Table rows={ROWS_MEAL} days={days} wMap={wMap} mMap={mMap}
                year={year} month={month} todayStr={todayStr}
                scrollRef={scrollRef2} onScroll={handleScroll2} />
              <div className="px-5 py-2.5 border-t border-gray-100 text-xs text-gray-400">
                スコア：<span className="text-blue-600 font-medium">90点以上</span>＝優秀
                <span className="text-green-600 font-medium">80〜89点</span>＝良好
                <span className="text-orange-500 font-medium">70〜79点</span>＝注意
                <span className="text-red-500 font-medium">69点以下</span>＝要改善
              </div>
            </>
          )}
        </div>
      </section>
    </>
  )
}
