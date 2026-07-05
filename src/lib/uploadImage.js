import { supabase } from './supabase'

/**
 * ブラウザのCanvas APIで画像を圧縮してJPEGに変換する。
 * HEIC はiOS Safariが自動デコードするため Canvas経由で変換可能。
 */
function compressImage(file, maxPx = 1200, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      let { width, height } = img
      if (width > maxPx || height > maxPx) {
        if (width >= height) {
          height = Math.round((height * maxPx) / width)
          width  = maxPx
        } else {
          width  = Math.round((width * maxPx) / height)
          height = maxPx
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width  = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('圧縮に失敗しました'))),
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('画像を読み込めませんでした'))
    }
    img.src = objectUrl
  })
}

/**
 * 画像を圧縮してSupabase Storageにアップロードし、公開URLを返す。
 * @param {File}   file      - 入力ファイル（jpg/png/heic）
 * @param {string} bucket    - バケット名（'meal-photos' | 'body-photos'）
 * @param {string} path      - Storage内パス（例: 'abc123/2025-01-01/breakfast.jpg'）
 * @returns {Promise<string>} 公開URL
 */
export async function uploadImage(file, bucket, path) {
  const compressed = await compressImage(file)

  // ① storage.upload の呼び出し内容
  console.log('[uploadImage] ① storage.upload 開始', { bucket, path, size: compressed.size, type: compressed.type })

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, compressed, { contentType: 'image/jpeg', upsert: true })

  // ② uploadError
  console.log('[uploadImage] ② uploadError:', uploadError)
  console.log('[uploadImage]    uploadData:', uploadData)

  if (uploadError) throw new Error(`アップロード失敗：${uploadError.message}`)

  // ③ getPublicUrl の戻り値
  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path)
  console.log('[uploadImage] ③ getPublicUrl:', urlData)

  return urlData.publicUrl
}

/**
 * Supabase Storageから画像を削除する。
 */
export async function deleteImage(bucket, path) {
  const { error } = await supabase.storage.from(bucket).remove([path])
  if (error) throw new Error(`削除失敗：${error.message}`)
}

/**
 * 公開URLからStorageのパスを取得する。
 * 例: https://xxx.supabase.co/storage/v1/object/public/meal-photos/abc/file.jpg
 *  → 'abc/file.jpg'
 */
export function urlToPath(publicUrl, bucket) {
  const marker = `/object/public/${bucket}/`
  const idx = publicUrl.indexOf(marker)
  return idx >= 0 ? publicUrl.slice(idx + marker.length) : null
}
