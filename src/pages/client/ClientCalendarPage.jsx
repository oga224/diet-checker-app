import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import BackButton from '../../components/BackButton'
import { format, getDaysInMonth } from 'date-fns'
import { ja } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'

function addM(y, m, d) {
  let nm = m + d, ny = y
  if (nm > 12) { nm -= 12; ny++ }
  if (nm < 1)  { nm += 12; ny-- }
  return { year: ny, month: nm }
}
function pad(n) { return String(n).padStart(2, '0') }

const DOW = ['日','月','火','水','木','金','土']

export default function ClientCalendarPage() {
  const { id }    = useParams()
  const navigate  = useNavigate()
  const now       = new Date()
  const today     = format(now, 'yyyy-MM-dd')
  const nowYM     = format(now, 'yyyy-MM')

  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [recordedDates, setRecordedDates] = useState(new Set())
  const [clientName,    setClientName]    = useState('')

  useEffect(() => {
    async function fetchData() {
      const [cr, dr] = await Promise.all([
        supabase.from('clients').select('name').eq('id', id).single(),
        supabase.from('weight_logs').select('date').eq('client_id', id),
      ])
      if (!cr.error) setClientName(cr.data?.name ?? '')
      if (!dr.error) setRecordedDates(new Set((dr.data ?? []).map(r => r.date)))
    }
    fetchData()
  }, [id])

  function goMonth(delta) {
    const n = addM(year, month, delta)
    setYear(n.year); setMonth(n.month)
  }

  const totalDays  = getDaysInMonth(new Date(year, month - 1))
  const firstDow   = new Date(year, month - 1, 1).getDay()
  const currentYM  = `${year}-${pad(month)}`
  const isFutureM  = currentYM > nowYM

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-600 text-white px-5 py-5 shadow-md">
        <div className="flex items-center gap-3">
          <BackButton to={`/client/${id}`} label="戻る" variant="light" />
          <h1 className="text-xl font-bold">カレンダー</h1>
        </div>
        {clientName && <p className="text-blue-200 text-sm mt-1 pl-9">{clientName} さん</p>}
      </header>

      <main className="max-w-sm mx-auto px-4 py-6">
        {/* 月ナビゲーション */}
        <div className="flex items-center justify-between mb-5">
          <button onClick={() => goMonth(-1)}
            className="w-12 h-12 rounded-full bg-white border border-gray-200 text-2xl flex items-center justify-center shadow-sm hover:bg-gray-50 active:scale-95">
            ‹
          </button>
          <h2 className="text-2xl font-black text-gray-800">
            {year}年{month}月
          </h2>
          <button onClick={() => goMonth(1)} disabled={isFutureM}
            className="w-12 h-12 rounded-full bg-white border border-gray-200 text-2xl flex items-center justify-center shadow-sm hover:bg-gray-50 active:scale-95 disabled:opacity-30">
            ›
          </button>
        </div>

        {/* 曜日ヘッダー */}
        <div className="grid grid-cols-7 mb-1">
          {DOW.map((d, i) => (
            <div key={d} className={`text-center text-sm font-bold py-1
              ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>
              {d}
            </div>
          ))}
        </div>

        {/* 日付グリッド */}
        <div className="grid grid-cols-7 gap-1">
          {/* 空白セル */}
          {Array.from({ length: firstDow }, (_, i) => <div key={`e${i}`} />)}

          {/* 日付 */}
          {Array.from({ length: totalDays }, (_, i) => {
            const day     = i + 1
            const dateStr = `${year}-${pad(month)}-${pad(day)}`
            const isToday = dateStr === today
            const isFuture  = dateStr > today
            const hasRecord = recordedDates.has(dateStr)
            const dow       = (firstDow + i) % 7
            const isWE      = dow === 0 || dow === 6

            return (
              <button
                key={day}
                type="button"
                disabled={isFuture}
                onClick={() => navigate(`/client/${id}/record/${dateStr}`)}
                className={[
                  'relative flex flex-col items-center justify-center h-12 w-full rounded-xl text-lg font-bold transition-all active:scale-95',
                  isToday   ? 'bg-blue-600 text-white shadow-md' : '',
                  !isToday && hasRecord ? 'bg-green-50 hover:bg-green-100' : '',
                  !isToday && !hasRecord && !isFuture ? 'bg-white hover:bg-gray-50' : '',
                  isFuture  ? 'text-gray-200 cursor-not-allowed' : '',
                  !isToday && isWE && !isFuture ? (dow === 0 ? 'text-red-400' : 'text-blue-400') : '',
                  !isToday && !isWE && !isFuture ? 'text-gray-800' : '',
                ].join(' ')}
              >
                {day}
                {hasRecord && !isToday && (
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-green-500 rounded-full" />
                )}
              </button>
            )
          })}
        </div>

        {/* 凡例 */}
        <div className="mt-6 flex gap-5 text-sm text-gray-500 justify-center">
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-lg bg-blue-600 inline-block" />今日
          </span>
          <span className="flex items-center gap-1.5">
            <span className="relative w-5 h-5 rounded-lg bg-green-50 border border-green-200 inline-block">
              <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-green-500 rounded-full" />
            </span>記録あり
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-lg bg-white border border-gray-200 inline-block" />未入力
          </span>
        </div>
        <p className="text-center text-sm text-gray-400 mt-2">日付をタップすると記録できます</p>
      </main>
    </div>
  )
}
