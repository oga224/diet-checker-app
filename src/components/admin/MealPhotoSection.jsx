import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'

const MEALS = [
  { key: 'breakfast_photo_url', label: '朝食', emoji: '🍳' },
  { key: 'lunch_photo_url',     label: '昼食', emoji: '🍱' },
  { key: 'dinner_photo_url',    label: '夕食', emoji: '🍚' },
  { key: 'snack_photo_url',     label: '間食', emoji: '🍰' },
]

function Lightbox({ url, label, onClose }) {
  // ESCキーで閉じる
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="relative max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white text-2xl font-bold hover:text-gray-300 transition-colors"
        >
          ✕ 閉じる
        </button>
        <img
          src={url}
          alt={label}
          className="w-full max-h-[80vh] object-contain rounded-xl shadow-2xl"
        />
        <p className="text-center text-white text-sm mt-3 opacity-70">{label}</p>
      </div>
    </div>
  )
}

function PhotoThumb({ url, label, onClick }) {
  if (!url) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className="w-full aspect-square rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50">
          <span className="text-xs text-gray-300 font-medium">写真なし</span>
        </div>
        <p className="text-xs text-gray-400 text-center">{label}</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => onClick(url, label)}
        className="w-full aspect-square rounded-xl overflow-hidden border border-gray-200 hover:ring-2 hover:ring-blue-400 transition-all focus:outline-none focus:ring-2 focus:ring-blue-400"
        title={`${label}を拡大表示`}
      >
        <img
          src={url}
          alt={label}
          className="w-full h-full object-cover hover:scale-105 transition-transform duration-200"
        />
      </button>
      <p className="text-xs text-gray-500 text-center font-medium">{label}</p>
    </div>
  )
}

export default function MealPhotoSection({ clientId }) {
  const [mealLogs, setMealLogs]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [lightbox, setLightbox]   = useState(null) // { url, label }
  const [page, setPage]           = useState(0)

  const PAGE_SIZE = 7

  useEffect(() => {
    async function fetchMealLogs() {
      const { data, error } = await supabase
        .from('meal_logs')
        .select('date, breakfast_photo_url, lunch_photo_url, dinner_photo_url, snack_photo_url')
        .eq('client_id', clientId)
        .order('date', { ascending: false })

      if (!error) setMealLogs(data ?? [])
      setLoading(false)
    }
    fetchMealLogs()
  }, [clientId])

  const totalPages = Math.ceil(mealLogs.length / PAGE_SIZE)
  const paginated  = mealLogs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const hasAnyPhoto = mealLogs.some((r) =>
    r.breakfast_photo_url || r.lunch_photo_url || r.dinner_photo_url || r.snack_photo_url
  )

  return (
    <>
      {lightbox && (
        <Lightbox
          url={lightbox.url}
          label={lightbox.label}
          onClose={() => setLightbox(null)}
        />
      )}

      <section className="bg-white rounded-xl border border-gray-200 px-6 py-5">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-5">
          食事写真
          {mealLogs.length > 0 && (
            <span className="text-gray-400 font-normal ml-2">（{mealLogs.length}日分）</span>
          )}
        </h2>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : !hasAnyPhoto ? (
          <p className="text-center py-8 text-gray-400 text-sm">
            食事写真がまだ登録されていません
          </p>
        ) : (
          <div className="space-y-6">
            {paginated.map((record) => {
              const dateLabel = format(parseISO(record.date), 'yyyy/M/d (E)', { locale: ja })
              const hasPhoto = MEALS.some(({ key }) => record[key])

              return (
                <div key={record.date}>
                  <p className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-2">
                    <span>{dateLabel}</span>
                    {!hasPhoto && (
                      <span className="text-xs text-gray-300 font-normal">写真なし</span>
                    )}
                  </p>
                  <div className="grid grid-cols-4 gap-3">
                    {MEALS.map(({ key, label, emoji }) => (
                      <PhotoThumb
                        key={key}
                        url={record[key] ?? null}
                        label={`${emoji} ${label}`}
                        onClick={(url, lbl) => setLightbox({ url, label: `${dateLabel} ${lbl}` })}
                      />
                    ))}
                  </div>
                </div>
              )
            })}

            {/* ページネーション */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 0}
                  className="px-3 py-1.5 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  ← 前
                </button>
                <span className="text-sm text-gray-400">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1.5 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  次 →
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  )
}
