import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'
import PhotoUpload from '../PhotoUpload'

const MEALS = [
  { key: 'breakfast', urlKey: 'breakfast_photo_url', label: '🍳 朝食' },
  { key: 'lunch',     urlKey: 'lunch_photo_url',     label: '🍱 昼食' },
  { key: 'dinner',    urlKey: 'dinner_photo_url',    label: '🍚 夕食' },
  { key: 'snack',     urlKey: 'snack_photo_url',     label: '🍰 間食' },
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
 * 指定日付の食事写真を表示・アップロードするコンポーネント（管理者用）
 * Props:
 *   clientId   - clients.id
 *   date       - 表示する日付（yyyy-MM-dd）
 *   sectionRef - 親からスクロール用に渡される ref
 *   showToast  - (type, msg) => void  トースト表示（省略可）
 */
export default function DailyMealPhotos({ clientId, date, sectionRef, showToast }) {
  const [mealLog,   setMealLog]   = useState(null)
  const [weightLog, setWeightLog] = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [lightbox,  setLightbox]  = useState(null)
  const [mode,      setMode]      = useState('view') // 'view' | 'upload'

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

  // 写真アップロード → meal_logs に即時 upsert
  async function handlePhotoUploaded(urlKey, url) {
    setMealLog(prev => ({ ...(prev ?? { client_id: clientId, date }), [urlKey]: url }))
    const { error } = await supabase
      .from('meal_logs')
      .upsert(
        { client_id: clientId, date, [urlKey]: url },
        { onConflict: 'client_id,date' }
      )
    if (error) {
      console.error('[DailyMealPhotos] meal_logs upsert error:', error)
      showToast?.('error', `写真の保存に失敗しました：${error.message}`)
      setMealLog(prev => ({ ...prev, [urlKey]: null }))
    } else {
      showToast?.('success', '写真を保存しました')
    }
  }

  // 写真削除 → meal_logs から URL を null に
  async function handlePhotoDeleted(urlKey) {
    setMealLog(prev => ({ ...(prev ?? {}), [urlKey]: null }))
    const { error } = await supabase
      .from('meal_logs')
      .upsert(
        { client_id: clientId, date, [urlKey]: null },
        { onConflict: 'client_id,date' }
      )
    if (error) {
      console.error('[DailyMealPhotos] meal_logs delete error:', error)
      showToast?.('error', `写真の削除に失敗しました：${error.message}`)
    }
  }

  const dateLabel = date
    ? format(parseISO(date), 'yyyy年M月d日 (E)', { locale: ja })
    : ''

  const hasAnyPhoto = MEALS.some(({ urlKey }) => mealLog?.[urlKey])

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
            <p className="text-base font-bold text-blue-700">📅 {dateLabel}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-full hidden sm:inline">
            月間表の日付クリックで切り替え
          </span>
          {/* 閲覧 / アップロード 切替 */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            {[
              { id: 'view',   label: '閲覧' },
              { id: 'upload', label: '管理者アップロード' },
            ].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={`px-3 py-1.5 transition-colors
                  ${mode === id
                    ? 'bg-blue-600 text-white font-medium'
                    : 'bg-white text-gray-500 hover:bg-gray-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : mode === 'upload' ? (
        /* ── アップロードモード ─────────────────────────────── */
        <div className="space-y-3">
          <p className="text-xs text-blue-600 font-medium bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
            🔑 管理者として写真を追加・変更できます。アップロード後すぐに保存されます。
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {MEALS.map(({ key, urlKey, label }) => (
              <PhotoUpload
                key={key}
                label={label}
                bucket="meal-photos"
                storagePath={`${clientId}/${date}/${key}.jpg`}
                url={mealLog?.[urlKey] ?? null}
                onUploaded={(url) => handlePhotoUploaded(urlKey, url)}
                onDeleted={() => handlePhotoDeleted(urlKey)}
                compact
              />
            ))}
          </div>
          {/* 写真クリックで拡大 */}
          {hasAnyPhoto && (
            <p className="text-xs text-gray-400 text-center mt-2">写真をクリックすると拡大表示されます（閲覧モードで確認）</p>
          )}
        </div>
      ) : (
        /* ── 閲覧モード ──────────────────────────────────────── */
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {MEALS.map(({ urlKey, label }) => {
              const url = mealLog?.[urlKey] ?? null
              return (
                <div key={urlKey} className="flex flex-col gap-1.5">
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
            <p className="text-center text-sm text-gray-400 py-4">
              この日の食事写真はありません
              <button
                type="button"
                onClick={() => setMode('upload')}
                className="ml-2 text-blue-500 underline hover:text-blue-700"
              >
                追加する
              </button>
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}
