import { useRef, useState } from 'react'
import { uploadImage, deleteImage, urlToPath } from '../lib/uploadImage'

/**
 * 汎用写真アップロードコンポーネント
 * Props:
 *   label      - 表示ラベル
 *   bucket     - Supabaseバケット名
 *   storagePath - アップロード先パス
 *   url        - 現在の公開URL（外部から管理）
 *   onUploaded(url) - アップロード完了時
 *   onDeleted()     - 削除完了時
 *   compact    - コンパクト表示モード（管理者画面用）
 */
export default function PhotoUpload({
  label, bucket, storagePath, url, onUploaded, onDeleted, compact = false,
}) {
  const inputRef   = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError]         = useState(null)

  async function handleChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const allowed = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']
    if (!allowed.includes(file.type) && !file.name.match(/\.(heic|heif)$/i)) {
      setError('JPG・PNG・HEICの画像を選んでください')
      return
    }

    setUploading(true)
    setError(null)
    try {
      const publicUrl = await uploadImage(file, bucket, storagePath)
      onUploaded(publicUrl)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete() {
    if (!url) return
    const path = urlToPath(url, bucket)
    setUploading(true)
    setError(null)
    try {
      if (path) await deleteImage(bucket, path)
      onDeleted()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  if (compact) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        {url ? (
          <div className="relative group">
            <img
              src={url}
              alt={label}
              className="w-full aspect-square object-cover rounded-xl border border-gray-200"
            />
            <button
              type="button"
              onClick={handleDelete}
              disabled={uploading}
              className="absolute top-1.5 right-1.5 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-full aspect-square rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-1 text-gray-300 hover:border-blue-300 hover:text-blue-300 transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-400 rounded-full animate-spin" />
            ) : (
              <>
                <span className="text-2xl">📷</span>
                <span className="text-xs">追加</span>
              </>
            )}
          </button>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif,image/webp,.heic,.heif"
          capture="environment"
          className="hidden"
          onChange={handleChange}
        />
      </div>
    )
  }

  // スマホ向け大きめデザイン
  return (
    <div className="space-y-2">
      <p className="text-base font-bold text-gray-700">{label}</p>
      {url ? (
        <div className="relative">
          <img
            src={url}
            alt={label}
            className="w-full max-h-64 object-cover rounded-2xl border border-gray-200"
          />
          <button
            type="button"
            onClick={handleDelete}
            disabled={uploading}
            className="absolute top-2 right-2 bg-red-500 text-white text-sm font-bold px-3 py-1.5 rounded-full shadow-md disabled:opacity-50"
          >
            {uploading ? '削除中…' : '削除'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full h-44 rounded-2xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 text-gray-400 bg-gray-50 active:bg-gray-100 transition-colors disabled:opacity-50"
        >
          {uploading ? (
            <>
              <div className="w-8 h-8 border-3 border-gray-300 border-t-blue-400 rounded-full animate-spin" />
              <span className="text-base">アップロード中…</span>
            </>
          ) : (
            <>
              <span className="text-4xl">📷</span>
              <span className="text-lg font-bold">写真を撮る・選ぶ</span>
              <span className="text-sm text-gray-300">JPG・PNG・HEICに対応</span>
            </>
          )}
        </button>
      )}
      {error && (
        <p className="text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif,image/webp,.heic,.heif"
        capture="environment"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  )
}
