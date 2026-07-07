import { useEffect, useMemo, useRef, useState } from 'react'
import { getDaysInMonth, format, parseISO } from 'date-fns'
import { supabase }    from '../../lib/supabase'
import { evaluateLog } from '../../lib/evaluateLog'

// ── ヘルパー ─────────────────────────────────────────────────
function addMonth(y, m, delta) {
  let nm = m + delta, ny = y
  if (nm > 12) { nm -= 12; ny++ }
  if (nm < 1)  { nm += 12; ny-- }
  return { year: ny, month: nm }
}
function pad(n) { return String(n).padStart(2, '0') }

/**
 * startY/startM から endY/endM まで全日付を配列で返す
 * @returns {{ year, month, day, dateStr }[]}
 */
function buildAllDays(startY, startM, endY, endM) {
  const days = []
  let y = startY, m = startM
  while (y < endY || (y === endY && m <= endM)) {
    const total = getDaysInMonth(new Date(y, m - 1))
    for (let d = 1; d <= total; d++) {
      days.push({ year: y, month: m, day: d, dateStr: `${y}-${pad(m)}-${pad(d)}` })
    }
    m++; if (m > 12) { m = 1; y++ }
  }
  return days
}

// 数字＋小さい単位を組み合わせるヘルパー
function numUnit(num, unit) {
  return <>{num}<span className="text-xs align-baseline ml-px">{unit}</span></>
}

// ── 表1 行定義：体調・生活記録 ───────────────────────────────
const ROWS_HEALTH = [
  {
    key: 'morning_kg', label: '朝体重',
    cell: (w) => w?.morning_kg != null
      ? { v: numUnit(w.morning_kg, 'kg'), c: 'text-gray-800 text-base' }
      : { v: '', c: '' },
  },
  {
    key: 'evening_kg', label: '夜体重',
    cell: (w) => w?.evening_kg != null
      ? { v: numUnit(w.evening_kg, 'kg'), c: 'text-gray-800 text-base' }
      : { v: '', c: '' },
  },
  {
    key: 'weight_diff', label: '朝→夜差',
    cell: (w) => {
      if (!w?.morning_kg || !w?.evening_kg) return { v: '', c: '' }
      const d = +(w.evening_kg - w.morning_kg).toFixed(1)
      return {
        v: `${d >= 0 ? '+' : ''}${d}`,
        c: d >= 0.6 ? 'text-red-500' : 'text-gray-800',
      }
    },
  },
  {
    key: 'eating_out', label: '外食',
    cell: (w) => {
      const p = []
      if (w?.ate_out_breakfast) p.push('M')
      if (w?.ate_out_lunch)     p.push('L')
      if (w?.ate_out_dinner)    p.push('D')
      return p.length ? { v: p.join(''), c: 'text-gray-800' } : { v: '', c: '' }
    },
  },
  {
    key: 'menstruation', label: '生理',
    cell: (w) => {
      const v = w?.menstruation
      const has = v === true || v === 'true' || v === '○' || v === '◯' || v === '〇' || v === 1 || v === '1'
      return has ? { v: '○', c: 'text-gray-800' } : { v: '', c: '' }
    },
  },
  {
    key: 'bowel', label: '排便',
    cell: (w) => {
      const v = w?.bowel_movement
      const has = v === true || v === 'true' || v === '○' || v === '◯' || v === '〇' || v === 1 || v === '1'
      return has ? { v: '○', c: 'text-gray-800' } : { v: '', c: '' }
    },
  },
  {
    key: 'water', label: '水分量',
    cell: (w) => {
      if (w?.water_ml == null) return { v: '', c: '' }
      // 100000以上は誤って1000倍された値と判断して補正（例: 1300000 → 1300ml）
      const ml = w.water_ml >= 100000 ? Math.round(w.water_ml / 1000) : w.water_ml
      const num = (ml / 1000).toFixed(1)
      return { v: numUnit(num, 'L'), c: ml >= 1500 ? 'text-gray-800 text-base' : 'text-red-500 text-base' }
    },
  },
  {
    key: 'toilet', label: 'トイレ',
    cell: (w) => {
      if (w?.toilet_count == null) return { v: '', c: '' }
      return { v: numUnit(w.toilet_count, '回'), c: w.toilet_count >= 10 ? 'text-gray-800 text-base' : 'text-red-500 text-base' }
    },
  },
  {
    key: 'sleep', label: '睡眠',
    cell: (w) => {
      if (w?.sleep_hours == null) return { v: '', c: '' }
      return { v: numUnit(w.sleep_hours, 'h'), c: w.sleep_hours >= 5.5 ? 'text-gray-800 text-base' : 'text-red-500 text-base' }
    },
  },
]

// ── 表2 行定義：食事・記録状況 ───────────────────────────────
const ROWS_MEAL = [
  {
    key: 'breakfast', label: '朝食',
    cell: (w) => {
      if (w?.ate_breakfast === true)  return { v: '○', c: 'text-gray-900' }
      if (w?.ate_breakfast === false) return { v: '×', c: 'text-gray-600' }
      return { v: '', c: '' }
    },
  },
  {
    key: 'lunch', label: '昼食',
    cell: (w) => {
      if (w?.ate_lunch === true)  return { v: '○', c: 'text-gray-900' }
      if (w?.ate_lunch === false) return { v: '×', c: 'text-gray-600' }
      return { v: '', c: '' }
    },
  },
  {
    key: 'dinner', label: '夕食',
    cell: (w) => {
      if (w?.ate_dinner === true)  return { v: '○', c: 'text-gray-900' }
      if (w?.ate_dinner === false) return { v: '×', c: 'text-gray-600' }
      return { v: '', c: '' }
    },
  },
  {
    key: 'snack', label: '間食',
    cell: (w) => {
      if (w?.ate_snack === false) return { v: 'なし', c: 'text-gray-900' }
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

// ── テーブル本体（連続日付対応版） ───────────────────────────
const DOW = ['日','月','火','水','木','金','土']

function Table({ rows, allDays, wMap, mMap, todayStr, selectedDate, scrollRef, onScroll, onDateClick }) {
  return (
    <div className="overflow-x-auto" ref={scrollRef} onScroll={onScroll}>
      <table className="border-collapse text-xs" style={{ minWidth: `${allDays.length * 44 + 80}px` }}>
        <thead>
          <tr>
            {/* 左固定：項目名 */}
            <th className="sticky left-0 z-20 bg-gray-50 text-left text-gray-600 font-medium
              px-3 py-2 border-r border-b border-gray-200 whitespace-nowrap min-w-[5rem]">
              項目
            </th>
            {allDays.map(({ year, month, day, dateStr }) => {
              const isFirst    = day === 1
              const dow        = DOW[new Date(year, month - 1, day).getDay()]
              const isWE       = [0, 6].includes(new Date(year, month - 1, day).getDay())
              const isToday    = dateStr === todayStr
              const isSelected = !isToday && dateStr === selectedDate
              const hasDat     = !!wMap[dateStr]
              return (
                <th key={dateStr}
                  data-today={isToday ? 'true' : undefined}
                  data-month={isFirst ? `${year}-${pad(month)}` : undefined}
                  onClick={() => onDateClick?.(dateStr, wMap[dateStr] ?? null)}
                  className={[
                    'text-center px-1 py-1.5 border-b min-w-[2.8rem]',
                    isFirst ? 'border-l-2 border-l-gray-300' : '',
                    isToday
                      ? 'bg-yellow-200 border-b-2 border-b-yellow-500 text-yellow-800 font-bold'
                      : isSelected
                        ? 'bg-blue-100 border-b-2 border-b-blue-500 text-blue-800 font-bold'
                        : hasDat ? 'bg-gray-50/60 border-b border-gray-200' : 'border-b border-gray-200',
                    !isToday && !isSelected && isWE ? 'text-red-500' : !isToday && !isSelected ? 'text-gray-800' : '',
                    onDateClick ? 'cursor-pointer hover:opacity-80' : '',
                  ].join(' ')}
                >
                  {/* 月頭に月ラベル */}
                  {isFirst && (
                    <div className="text-[10px] font-bold text-gray-500 leading-none mb-0.5">
                      {month}月
                    </div>
                  )}
                  <div className="font-medium leading-none">{day}</div>
                  <div className={`leading-none mt-0.5 ${isToday ? 'text-yellow-600' : isSelected ? 'text-blue-600' : isWE ? 'text-red-400' : 'text-gray-700'}`}>{dow}</div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={row.key} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}>
              <td className={`sticky left-0 z-10 px-3 py-2 font-semibold text-gray-800
                border-r border-gray-200 whitespace-nowrap
                ${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                {row.label}
              </td>
              {allDays.map(({ dateStr, day }) => {
                const isFirst    = day === 1
                const isToday    = dateStr === todayStr
                const isSelected = !isToday && dateStr === selectedDate
                const { v, c } = row.cell(wMap[dateStr] ?? null, mMap[dateStr] ?? null)
                return (
                  <td key={dateStr}
                    className={[
                      'text-center px-1 py-2 border-b border-gray-100',
                      c,
                      isToday    ? 'bg-yellow-50' : '',
                      isSelected ? 'bg-blue-50'   : '',
                      isFirst    ? 'border-l-2 border-l-gray-200' : '',
                    ].join(' ')}
                  >
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
export default function MonthlyTable({ clientId, onDateClick, refreshKey = 0, selectedDate, renderBetween }) {
  const now = new Date()
  // ナビゲーション用（← → ボタンで制御するフォーカス月）
  const [selYear,  setSelYear]  = useState(now.getFullYear())
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1)
  // 全データ範囲
  const [dateRange, setDateRange] = useState(null)
  const [wMap, setWMap] = useState({})
  const [mMap, setMMap] = useState({})
  const [loading, setLoading] = useState(true)

  const scrollRef1   = useRef(null)
  const scrollRef2   = useRef(null)
  const isSyncing    = useRef(false)
  const initialScroll = useRef(false) // 初回自動スクロール完了フラグ

  const todayStr = format(now, 'yyyy-MM-dd')

  // 全日付配列（メモ化）
  const allDays = useMemo(() => {
    if (!dateRange) return []
    return buildAllDays(dateRange.startY, dateRange.startM, dateRange.endY, dateRange.endM)
  }, [dateRange])

  // ── データ取得：最古記録を取得 → 全範囲のデータをフェッチ ──
  useEffect(() => {
    initialScroll.current = false
    setLoading(true)

    async function init() {
      // 最古の weight_log 日付を取得
      const { data: oldestRows } = await supabase
        .from('weight_logs')
        .select('date')
        .eq('client_id', clientId)
        .order('date', { ascending: true })
        .limit(1)

      // 開始月を決定
      let startY, startM
      if (oldestRows?.[0]?.date) {
        const d  = parseISO(oldestRows[0].date)
        startY = d.getFullYear()
        startM = d.getMonth() + 1
      } else {
        // 記録なし → 3ヶ月前から
        const fallback = addMonth(now.getFullYear(), now.getMonth() + 1, -2)
        startY = fallback.year; startM = fallback.month
      }

      // 終了月 = 翌月（今日基準）
      const endNext = addMonth(now.getFullYear(), now.getMonth() + 1, 1)
      const endY = endNext.year, endM = endNext.month

      setDateRange({ startY, startM, endY, endM })

      // データをフェッチ
      const startStr = `${startY}-${pad(startM)}-01`
      const endD     = getDaysInMonth(new Date(endY, endM - 1))
      const endStr   = `${endY}-${pad(endM)}-${pad(endD)}`

      const [wRes, mRes] = await Promise.all([
        supabase.from('weight_logs').select('*')
          .eq('client_id', clientId).gte('date', startStr).lte('date', endStr),
        supabase.from('meal_logs')
          .select('date, breakfast_photo_url, lunch_photo_url, dinner_photo_url, snack_photo_url')
          .eq('client_id', clientId).gte('date', startStr).lte('date', endStr),
      ])

      const wm = {}; (wRes.data ?? []).forEach(l => { wm[l.date] = l })
      const mm = {}; (mRes.data ?? []).forEach(l => { mm[l.date] = l })
      setWMap(wm); setMMap(mm)
      setLoading(false)
    }

    init()
  }, [clientId, refreshKey])

  // ── 初回ロード後：今日の列へ自動スクロール ──────────────────
  useEffect(() => {
    if (loading || !allDays.length || initialScroll.current) return
    setTimeout(() => {
      scrollToDate(todayStr, true) // 今日を中央に
      initialScroll.current = true
    }, 120)
  }, [loading, allDays])

  // ── 日付位置へスクロール ──────────────────────────────────
  function scrollToDate(targetDateStr, center = false) {
    const ref = scrollRef1.current
    if (!ref) return
    const el = ref.querySelector(`[data-today="true"]`) || ref.querySelector(`[data-month="${targetDateStr}"]`)
    if (!el) return
    const stickyW = 80
    let left
    if (center) {
      const cw = ref.clientWidth
      left = Math.max(0, el.offsetLeft - stickyW - (cw - stickyW) / 2 + el.offsetWidth / 2)
    } else {
      left = Math.max(0, el.offsetLeft - stickyW)
    }
    ref.scrollLeft = left
    if (scrollRef2.current) scrollRef2.current.scrollLeft = left
  }

  function scrollToMonth(y, m) {
    const ref = scrollRef1.current
    if (!ref) return
    const key = `${y}-${pad(m)}`
    const el  = ref.querySelector(`[data-month="${key}"]`)
    if (!el) return
    const left = Math.max(0, el.offsetLeft - 80)
    ref.scrollLeft = left
    if (scrollRef2.current) scrollRef2.current.scrollLeft = left
  }

  // ── 同期スクロール ──────────────────────────────────────
  function handleScroll1(e) {
    if (isSyncing.current) return
    isSyncing.current = true
    if (scrollRef2.current) scrollRef2.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => { isSyncing.current = false })
  }
  function handleScroll2(e) {
    if (isSyncing.current) return
    isSyncing.current = true
    if (scrollRef1.current) scrollRef1.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => { isSyncing.current = false })
  }

  // ← → ボタン：フォーカス月を変えて、その月へスクロール
  function navigate(delta) {
    const n = addMonth(selYear, selMonth, delta)
    setSelYear(n.year); setSelMonth(n.month)
    setTimeout(() => scrollToMonth(n.year, n.month), 50)
  }

  const Nav = (
    <div className="flex items-center gap-2">
      <button onClick={() => navigate(-1)}
        className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors">
        ← 前月
      </button>
      <span className="text-sm font-bold text-gray-700 w-24 text-center">
        {selYear}年{selMonth}月
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

  const rangeLabel = dateRange
    ? `${dateRange.startY}年${dateRange.startM}月〜${dateRange.endY}年${dateRange.endM}月`
    : ''

  return (
    <>
      {/* ── 表1：体調・生活記録 ── */}
      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
          <div className="flex items-center justify-center mb-2">{Nav}</div>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-600">表1：体調・生活記録</h2>
            {rangeLabel && <p className="text-xs text-gray-400">{rangeLabel}</p>}
          </div>
        </div>
        {loading ? Spinner : (
          <>
            <Table rows={ROWS_HEALTH} allDays={allDays} wMap={wMap} mMap={mMap}
              todayStr={todayStr} selectedDate={selectedDate}
              scrollRef={scrollRef1} onScroll={handleScroll1}
              onDateClick={onDateClick} />
            <div className="px-5 py-2.5 border-t border-gray-100 text-xs text-gray-400">
              <span className="text-red-500 font-medium">赤字</span>＝朝→夜差 +0.6kg以上・水分 1.4L以下・トイレ 9回以下・睡眠 5時間以下
            </div>
          </>
        )}
      </section>

      {/* ── renderBetween スロット（表1と表2の間に挿入） ── */}
      {renderBetween}

      {/* ── 表2：食事・記録状況 ── */}
      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-600">表2：食事・記録状況</h2>
        </div>
        {loading ? Spinner : (
          <>
            <Table rows={ROWS_MEAL} allDays={allDays} wMap={wMap} mMap={mMap}
              todayStr={todayStr} selectedDate={selectedDate}
              scrollRef={scrollRef2} onScroll={handleScroll2}
              onDateClick={onDateClick} />
            <div className="px-5 py-2.5 border-t border-gray-100 text-xs text-gray-400">
              スコア：<span className="text-blue-600 font-medium">90点以上</span>＝優秀
              <span className="text-green-600 font-medium">80〜89点</span>＝良好
              <span className="text-orange-500 font-medium">70〜79点</span>＝注意
              <span className="text-red-500 font-medium">69点以下</span>＝要改善
            </div>
          </>
        )}
      </section>
    </>
  )
}
