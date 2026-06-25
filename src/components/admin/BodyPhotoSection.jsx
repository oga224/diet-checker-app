import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { deleteImage, urlToPath } from '../../lib/uploadImage'
import PhotoUpload from '../PhotoUpload'

const DIRECTIONS = [
  { key: 'front', urlKey: 'front_photo_url', label: '正面' },
  { key: 'back',  urlKey: 'back_photo_url',  label: '背面' },
  { key: 'right', urlKey: 'right_photo_url', label: '右側面' },
  { key: 'left',  urlKey: 'left_photo_url',  label: '左側面' },
]

const TODAY = format(new Date(), 'yyyy-MM-dd')

// ─────────────────────────────────────────────
// ライトボックス
// ─────────────────────────────────────────────
function Lightbox({ url, label, onClose }) {
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white text-lg font-bold hover:text-gray-300 transition-colors"
        >
          ✕ 閉じる
        </button>
        <img src={url} alt={label} className="w-full max-h-[80vh] object-contain rounded-xl shadow-2xl" />
        <p className="text-center text-white/70 text-sm mt-3">{label}</p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 比較ビュー（初回 vs 最新）
// ─────────────────────────────────────────────
function CompareView({ records, onLightbox }) {
  const [activeDir, setActiveDir] = useState('front')

  if (records.length === 0) {
    return <p className="text-center py-8 text-gray-400 text-sm">写真記録がありません</p>
  }

  const first  = [...records].sort((a, b) => a.date.localeCompare(b.date))[0]
  const latest = [...records].sort((a, b) => b.date.localeCompare(a.date))[0]
  const isSame = first.date === latest.date

  const dir = DIRECTIONS.find((d) => d.key === activeDir)
  const firstUrl  = first[dir.urlKey]
  const latestUrl = latest[dir.urlKey]

  return (
    <div className="space-y-4">
      {/* 方向タブ */}
      <div className="flex gap-2 flex-wrap">
        {DIRECTIONS.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setActiveDir(d.key)}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors
              ${activeDir === d.key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'}`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {isSame ? (
        <p className="text-sm text-gray-400 text-center py-4">
          記録が1件のみのため比較できません。写真を追加してください。
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {/* 初回 */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-400 text-center">
              初回 <span className="font-normal">{first.date}</span>
            </p>
            {firstUrl ? (
              <button
                type="button"
                onClick={() => onLightbox(firstUrl, `初回 ${dir.label} (${first.date})`)}
                className="w-full aspect-[3/4] rounded-xl overflow-hidden border border-gray-200 hover:ring-2 hover:ring-blue-400 transition-all"
              >
                <img src={firstUrl} alt="初回" className="w-full h-full object-cover" />
              </button>
            ) : (
              <div className="w-full aspect-[3/4] rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50">
                <span className="text-xs text-gray-300">写真なし</span>
              </div>
            )}
          </div>

          {/* 最新 */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-blue-500 text-center">
              最新 <span className="font-normal text-gray-400">{latest.date}</span>
            </p>
            {latestUrl ? (
              <button
                type="button"
                onClick={() => onLightbox(latestUrl, `最新 ${dir.label} (${latest.date})`)}
                className="w-full aspect-[3/4] rounded-xl overflow-hidden border border-blue-200 hover:ring-2 hover:ring-blue-400 transition-all"
              >
                <img src={latestUrl} alt="最新" className="w-full h-full object-cover" />
              </button>
            ) : (
              <div className="w-full aspect-[3/4] rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50">
                <span className="text-xs text-gray-300">写真なし</span>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 text-center">写真をクリックすると拡大表示されます</p>
    </div>
  )
}

// ─────────────────────────────────────────────
// メインコンポーネント
// ─────────────────────────────────────────────
export default function BodyPhotoSection({ clientId, showToast }) {
  const [records, setRecords]           = useState([])
  const [selectedDate, setSelectedDate] = useState(TODAY)
  const [current, setCurrent]           = useState(null)
  const [photos, setPhotos]             = useState({ front: null, back: null, right: null, left: null })
  const [loading, setLoading]           = useState(true)
  const [saving, setSaving]             = useState(false)
  const [deleting, setDeleting]         = useState(false)
  const [tab, setTab]                   = useState('upload') // 'upload' | 'compare'
  const [lightbox, setLightbox]         = useState(null)     // { url, label }
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  async function fetchRecords() {
    const { data } = await supabase
      .from('body_photos')
      .select('*')
      .eq('client_id', clientId)
      .order('date', { ascending: false })
    setRecords(data ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchRecords() }, [clientId])

  useEffect(() => {
    const rec = records.find((r) => r.date === selectedDate) ?? null
    setCurrent(rec)
    setPhotos({
      front: rec?.front_photo_url ?? null,
      back:  rec?.back_photo_url  ?? null,
      right: rec?.right_photo_url ?? null,
      left:  rec?.left_photo_url  ?? null,
    })
    setShowDeleteConfirm(false)
  }, [selectedDate, records])

  function setPhoto(key, url) {
    setPhotos((p) => ({ ...p, [key]: url }))
  }

  // 保存
  async function handleSave() {
    setSaving(true)
    const payload = {
      client_id:       clientId,
      date:            selectedDate,
      front_photo_url: photos.front,
      back_photo_url:  photos.back,
      right_photo_url: photos.right,
      left_photo_url:  photos.left,
    }
    const { error } = current
      ? await supabase.from('body_photos').update(payload).eq('id', current.id)
      : await supabase.from('body_photos').insert(payload)
    setSaving(false)
    if (error) {
      showToast('error', `保存失敗：${error.message}`)
    } else {
      showToast('success', `${selectedDate} の体型写真を保存しました`)
      fetchRecords()
    }
  }

  // レコード削除（Storage + DB）
  async function handleDeleteRecord() {
    if (!current) return
    setDeleting(true)

    // Storage の画像を削除（エラーは無視して続行）
    const deleteJobs = DIRECTIONS
      .map((d) => current[d.urlKey])
      .filter(Boolean)
      .map((url) => {
        const path = urlToPath(url, 'body-photos')
        return path ? deleteImage('body-photos', path).catch(() => {}) : Promise.resolve()
      })
    await Promise.all(deleteJobs)

    // DB レコード削除
    const { error } = await supabase.from('body_photos').delete().eq('id', current.id)
    setDeleting(false)
    setShowDeleteConfirm(false)
    if (error) {
      showToast('error', `削除失敗：${error.message}`)
    } else {
      showToast('success', `${selectedDate} の体型写真を削除しました`)
      setSelectedDate(TODAY)
      fetchRecords()
    }
  }

  const storagePath  = (dir) => `${clientId}/${selectedDate}/${dir}.jpg`
  const hasAnyPhoto  = Object.values(photos).some(Boolean)
  const hasRecords   = records.length > 0

  return (
    <>
      {lightbox && (
        <Lightbox url={lightbox.url} label={lightbox.label} onClose={() => setLightbox(null)} />
      )}

      <section className="bg-white rounded-xl border border-gray-200 px-6 py-5">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">体型写真</h2>
            {hasRecords && (
              <span className="text-xs text-gray-400">（{records.length}件）</span>
            )}
          </div>
          {/* タブ切替 */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {[{ id: 'upload', label: 'アップロード' }, { id: 'compare', label: '初回 vs 最新' }].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`px-3 py-1.5 transition-colors
                  ${tab === id ? 'bg-blue-600 text-white font-medium' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : tab === 'compare' ? (
          <CompareView records={records} onLightbox={(url, label) => setLightbox({ url, label })} />
        ) : (
          <>
            {/* 日付選択 */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={TODAY}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:border-blue-400"
              />
              {hasRecords && (
                <select
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 focus:outline-none focus:border-blue-400"
                >
                  <option value={TODAY}>今日</option>
                  {records
                    .filter((r) => r.date !== TODAY)
                    .map((r) => <option key={r.date} value={r.date}>{r.date}</option>)}
                </select>
              )}
              {current && (
                <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-1 rounded-full">
                  保存済み
                </span>
              )}
            </div>

            {/* 4方向アップロード */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
              {DIRECTIONS.map(({ key, label }) => (
                <PhotoUpload
                  key={key}
                  label={label}
                  bucket="body-photos"
                  storagePath={storagePath(key)}
                  url={photos[key]}
                  onUploaded={(url) => {
                    setPhoto(key, url)
                    // アップロード後に既存写真をクリックで見られるようにする
                  }}
                  onDeleted={() => setPhoto(key, null)}
                  compact
                />
              ))}
            </div>

            {/* 写真クリックで拡大（保存済み写真） */}
            {hasAnyPhoto && (
              <div className="mb-4">
                <p className="text-xs text-gray-400 mb-2">写真をクリックすると拡大表示されます</p>
                <div className="grid grid-cols-4 gap-2">
                  {DIRECTIONS.map(({ key, label }) =>
                    photos[key] ? (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setLightbox({ url: photos[key], label: `${label} (${selectedDate})` })}
                        className="aspect-square rounded-lg overflow-hidden border border-gray-200 hover:ring-2 hover:ring-blue-400 transition-all"
                      >
                        <img src={photos[key]} alt={label} className="w-full h-full object-cover" />
                      </button>
                    ) : null
                  )}
                </div>
              </div>
            )}

            {/* 保存ボタン */}
            {hasAnyPhoto && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="w-full py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors mb-3"
              >
                {saving ? '保存中…' : `${selectedDate} の写真を保存する`}
              </button>
            )}

            {/* 削除ボタン */}
            {current && (
              <div>
                {!showDeleteConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full py-2 text-sm text-red-400 border border-red-100 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    {selectedDate} のデータを削除する
                  </button>
                ) : (
                  <div className="border border-red-200 rounded-lg px-4 py-3 bg-red-50 flex items-center justify-between gap-3">
                    <p className="text-sm text-red-600 font-medium">本当に削除しますか？</p>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(false)}
                        className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                      >
                        キャンセル
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteRecord}
                        disabled={deleting}
                        className="px-3 py-1.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                      >
                        {deleting ? '削除中…' : '削除する'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 撮影履歴 */}
            {hasRecords && (
              <div className="mt-5 pt-5 border-t border-gray-100">
                <p className="text-xs text-gray-400 font-medium mb-3">撮影履歴</p>
                <div className="flex gap-2 flex-wrap">
                  {records.map((r) => {
                    const hasPhoto = DIRECTIONS.some(({ urlKey }) => r[urlKey])
                    return (
                      <button
                        key={r.date}
                        type="button"
                        onClick={() => setSelectedDate(r.date)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5
                          ${selectedDate === r.date
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'}`}
                      >
                        {r.date}
                        {hasPhoto && (
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${selectedDate === r.date ? 'bg-blue-200' : 'bg-blue-400'}`} />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </>
  )
}
