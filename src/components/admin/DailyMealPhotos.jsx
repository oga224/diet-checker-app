import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'

const MEALS = [
  { key: 'breakfast_photo_url', label: '🍳 朝食' },
  { key: 'lunch_photo_url',     label: '🍱 昼食' },
  { key: 'dinner_photo_url',    label: '🍚 夕食' },
  { key: 'snack_photo_url',     label: '🍰 間食' },
]

function Lightbox({ url, label, onClose }) {
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose}
          className="absolute -top-10 right-0 text-white text-lg font-bold hover:text-gray-300 transition-colors">
          ✕ 閉じる
        </button>
        <img src={url} alt={label} className="w-full max-h-[80vh] object-contain rounded-xl shadow-2xl" />
        <p className="text-center text-white/70 text-sm mt-3">{label}</p>
      </div>
    </div>
  )
}

/**
 * 指定日付の食事写真を表示するコンポーネント
 * Props:
 *   clientId   - clients.id
 *   date       - 表示する日付（yyyy-MM-dd）
 *   sectionRef - 親からスクロール用に渡される ref
 */
export default function DailyMealPhotos({ clientId, date, sectionRef }) {
  const [mealLog,   setMealLog]   = useState(null)
  const [weightLog, setWeightLog] = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [lightbox,  setLightbox]  = useState(null)

  useEffect(() => {
    if (!date) return
    setLoading(true)
    async function fetchDay() {
      const [mealRes, wRes] = await Promise.all([
        supabase.from('meal_logs').select('*')
          .eq('client_id', clientId).eq('date', date).maybeSingle(),
        supabase.from('weight_logs')
          .select('comment, morning_kg, evening_kg')
          .eq('client_id', clientId).eq('date', date).maybeSingle(),
      ])
      setMealLog(!mealRes.error ? mealRes.data : null)
      setWeightLog(!wRes.error ? wRes.data : null)
      setLoading(false)
    }
    fetchDay()
  }, [clientId, date])

  const dateLabel = date
    ? format(parseISO(date), 'yyyy年M月d日 (E)', { locale: ja })
    : ''

  const hasAnyPhoto = MEALS.some(({ key }) => mealLog?.[key])

  return (
    <section ref={sectionRef} className="bg-white rounded-xl border border-gray-200 px-6 py-5">
      {lightbox && (
        <Lightbox url={lightbox.url} label={lightbox.label} onClose={() => setLightbox(null)} />
      )}

      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">食事写真</h2>
          {dateLabel && (
            <p className="text-base font-bold text-blue-700">
              📅 {dateLabel}
            </p>
          )}
        </div>
        <span className="text-xs text-gray-400 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-full hidden sm:inline">
          月間表の日付クリックで切り替え
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* 写真グリッド（写真あり・なしを全4枠表示） */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {MEALS.map(({ key, label }) => {
              const url = mealLog?.[key] ?? null
              return (
                <div key={key} className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-gray-500 text-center">{label}</p>
                  {url ? (
                    <button
                      type="button"
                      onClick={() => setLightbox({ url, label: `${dateLabel} ${label}` })}
                      className="w-full aspect-square rounded-xl overflow-hidden border border-gray-200 hover:ring-2 hover:ring-blue-400 transition-all focus:outline-none"
                      title={`${label}を拡大表示`}
                    >
                      <img src={url} alt={label} className="w-full h-full object-cover hover:scale-105 transition-transform duration-200" />
                    </button>
                  ) : (
                    <div className="w-full aspect-square rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50">
                      <span className="text-xs text-gray-300">写真なし</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* コメント */}
          {weightLog?.comment ? (
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-400 mb-1 font-medium">💬 コメント</p>
              <p className="text-sm text-gray-700 leading-relaxed">{weightLog.comment}</p>
            </div>
          ) : !hasAnyPhoto ? (
            <p className="text-center text-sm text-gray-400 py-4">この日の食事写真はありません</p>
          ) : null}
        </div>
      )}
    </section>
  )
}
