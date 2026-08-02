import { useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import BackButton from '../../components/BackButton'

// ── 共通定数（Function側 supabase/functions/ocr-to-csv/index.ts と同じ値）────
const MAX_IMAGES = 10
const MAX_IMAGE_BYTES = 5 * 1024 * 1024          // 5 MiB（圧縮後の1画像あたり）
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024   // 20 MiB（圧縮後の全画像合計）
// 元ファイル選択時の上限（ブラウザ負荷防止のみが目的。圧縮後は5MiBよりずっと小さくなりうるため
// 元ファイルの大きさだけで即座に拒否はしない）
const MAX_ORIGINAL_FILE_BYTES = 25 * 1024 * 1024 // 25 MiB
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const DATA_URL_RE = /^data:([^;]+);base64,([A-Za-z0-9+/]*={0,2})$/

/** base64文字列（padding含む）から、デコード後の正確なバイト数を計算する（Function側と同じ式） */
function base64ByteLength(base64) {
  let padding = 0
  if (base64.endsWith('==')) padding = 2
  else if (base64.endsWith('=')) padding = 1
  return (base64.length * 3) / 4 - padding
}

// ── 画像圧縮（OCR精度のため最大1600px） ─────────────────────────
function compressForOcr(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const MAX = 1600
      let { width, height } = img
      if (width > MAX || height > MAX) {
        if (width >= height) { height = Math.round(height * MAX / width); width = MAX }
        else { width = Math.round(width * MAX / height); height = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', 0.88))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像読み込み失敗')) }
    img.src = url
  })
}

// ── CSV変換ヘルパー ───────────────────────────────────────────
function rowsToCsv(rows) {
  const headers = ['date','morning_weight','night_weight','eating_out','period_day','bowel_movement','water_liters','toilet_count','sleep_hours']
  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push(headers.map(h => {
      const v = r[h] ?? ''
      return v.includes(',') ? `"${v}"` : v
    }).join(','))
  }
  return lines.join('\n')
}

// ── DBレコード変換 ────────────────────────────────────────────
function rowToWeightLog(row, clientId) {
  function floatOrNull(v) { const n = parseFloat(v); return isNaN(n) ? null : n }
  function intOrNull(v)   { const n = parseInt(v, 10); return isNaN(n) ? null : n }
  function boolOrNull(v)  {
    if (!v || v.trim() === '') return null
    const s = v.trim().toLowerCase()
    if (['true', '○', '◯', '〇', '1', 'yes', '有', 'あり'].includes(s)) return true
    if (['false', '×', '0', 'no', '無', 'なし'].includes(s)) return false
    return null
  }
  function eatOut(v) {
    const s = (v ?? '').toUpperCase()
    if (!s) return { ate_out_breakfast: false, ate_out_lunch: false, ate_out_dinner: false }
    if (s === 'TRUE' || s === '○' || s === '◯') return { ate_out_breakfast: true, ate_out_lunch: true, ate_out_dinner: true }
    return {
      ate_out_breakfast: s.includes('M') || s.includes('B'),
      ate_out_lunch:     s.includes('L'),
      ate_out_dinner:    s.includes('D'),
    }
  }
  // OCRはL単位で出力。100以上ならml判断（安全ガード）
  const waterL = floatOrNull(row.water_liters)
  const waterMl = waterL === null ? null
    : waterL >= 100 ? Math.round(waterL)          // すでにml
    : Math.round(waterL * 1000)                    // L→ml変換
  return {
    client_id:      clientId,
    date:           row.date,
    morning_kg:     floatOrNull(row.morning_weight),
    evening_kg:     floatOrNull(row.night_weight),
    ...eatOut(row.eating_out),
    menstruation:   boolOrNull(row.period_day),
    bowel_movement: boolOrNull(row.bowel_movement),
    water_ml:       waterMl,
    toilet_count:   intOrNull(row.toilet_count),
    sleep_hours:    floatOrNull(row.sleep_hours),
  }
}

// ── テーブルの編集可能セル ────────────────────────────────────
function EditCell({ value, onChange, type = 'text', placeholder = '' }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full min-w-[3.5rem] text-xs px-1.5 py-1 rounded border border-transparent
        focus:border-blue-300 focus:outline-none focus:bg-blue-50 hover:border-gray-300
        bg-transparent text-center transition-colors"
    />
  )
}

const COLS = [
  { key: 'date',          label: '日付',     ph: 'YYYY-MM-DD', w: 'min-w-[8rem]' },
  { key: 'morning_weight',label: '朝体重',   ph: '73.5',       w: 'min-w-[4rem]' },
  { key: 'night_weight',  label: '夜体重',   ph: '74.0',       w: 'min-w-[4rem]' },
  { key: 'eating_out',    label: '外食',     ph: 'L',          w: 'min-w-[3rem]' },
  { key: 'period_day',    label: '生理',     ph: '',           w: 'min-w-[3rem]' },
  { key: 'bowel_movement',label: '排便',     ph: '',           w: 'min-w-[3rem]' },
  { key: 'water_liters',  label: '水分(L)',  ph: '1.5',        w: 'min-w-[4rem]' },
  { key: 'toilet_count',  label: 'トイレ',   ph: '10',         w: 'min-w-[3.5rem]' },
  { key: 'sleep_hours',   label: '睡眠(h)',  ph: '7',          w: 'min-w-[3.5rem]' },
]

const STEPS = ['画像アップロード', 'OCR解析中', 'プレビュー・編集', 'インポート完了']

export default function ClientOcrImportPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const dropRef  = useRef(null)
  const fileRef  = useRef(null)

  const [step,       setStep]       = useState(0)  // 0=upload 1=ocring 2=preview 3=done
  const [images,     setImages]     = useState([]) // { file, previewUrl }[]
  const [rows,       setRows]       = useState([]) // OCR結果（編集可能）
  const [ocrError,   setOcrError]   = useState(null)
  const [importing,  setImporting]  = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [isDragging, setIsDragging] = useState(false)

  // ── 画像追加 ──────────────────────────────────────────────
  function addImages(files) {
    const incoming = Array.from(files)
    const errors = []
    const accepted = []

    const isDuplicate = (file, others) => others.some(f =>
      f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
    )

    for (const file of incoming) {
      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        errors.push(`${file.name}: 対応していない形式です（JPEG・PNG・WebPのみ）`)
        continue
      }
      if (file.size > MAX_ORIGINAL_FILE_BYTES) {
        errors.push(`${file.name}: 元画像の容量が大きすぎます。25MB以下の画像を選択してください`)
        continue
      }
      if (isDuplicate(file, images.map(img => img.file)) || isDuplicate(file, accepted)) {
        errors.push(`${file.name}: 既に選択されています`)
        continue
      }
      accepted.push(file)
    }

    const remainingSlots = Math.max(MAX_IMAGES - images.length, 0)
    if (accepted.length > remainingSlots) {
      errors.push(`画像は最大${MAX_IMAGES}枚までです`)
    }
    const toAdd = accepted.slice(0, remainingSlots)

    if (errors.length) setOcrError(errors.join('\n'))
    if (!toAdd.length) return

    const newImages = toAdd.map(file => ({
      file,
      previewUrl: URL.createObjectURL(file),
      name: file.name,
    }))
    setImages(prev => [...prev, ...newImages])
  }

  function removeImage(idx) {
    setImages(prev => {
      URL.revokeObjectURL(prev[idx].previewUrl)
      return prev.filter((_, i) => i !== idx)
    })
  }

  // ── ドラッグ&ドロップ ──────────────────────────────────────
  const handleDragOver  = useCallback(e => { e.preventDefault(); setIsDragging(true) }, [])
  const handleDragLeave = useCallback(() => setIsDragging(false), [])
  const handleDrop      = useCallback(e => {
    e.preventDefault(); setIsDragging(false)
    addImages(e.dataTransfer.files)
  }, [])

  // ── Edge Functionのエラーから、利用者向けメッセージを安全に取り出す ──
  // 優先順位: 1. Function本文のerror（安全に取得できた場合） 2. status対応の固定文言 3. 一般フォールバック
  async function resolveOcrErrorMessage(error) {
    if (error instanceof FunctionsHttpError) {
      const status = error.context?.status
      let body = null
      try { body = await error.context?.json() } catch { body = null }
      const safeMessage = body && typeof body === 'object' && typeof body.error === 'string'
        ? body.error
        : null
      if (safeMessage) return safeMessage
      if (status === 401) return 'ログイン状態を確認できませんでした。再ログインしてください'
      if (status === 403) return 'この機能を利用する権限がありません'
      if (status === 413) return '画像の枚数または容量が上限を超えています'
      if (status === 415) return '対応していない画像形式が含まれています'
      if (status === 503) return '画像読み取りサービスが混雑しています。しばらくしてから再度お試しください'
      return '画像の読み取りに失敗しました'
    }
    if (error instanceof FunctionsRelayError) return 'サーバーとの通信中にエラーが発生しました'
    if (error instanceof FunctionsFetchError) return '画像読み取りサーバーへ接続できませんでした'
    return error?.message || '画像の読み取りに失敗しました'
  }

  // ── OCR実行 ───────────────────────────────────────────────
  async function handleOcr() {
    if (!images.length) return
    setStep(1); setOcrError(null)
    try {
      // 圧縮してbase64に変換
      const base64Images = await Promise.all(images.map(img => compressForOcr(img.file)))

      // ── 圧縮後の検証（Function呼び出し前。Function側と同じ上限・計算式）──
      if (base64Images.length > MAX_IMAGES) {
        throw new Error(`画像は最大${MAX_IMAGES}枚までです`)
      }
      const seenDataUrls = new Set()
      let totalBytes = 0
      for (let i = 0; i < base64Images.length; i++) {
        const dataUrl = base64Images[i]
        const match = typeof dataUrl === 'string' ? dataUrl.match(DATA_URL_RE) : null
        if (!match) throw new Error(`画像${i + 1}: 圧縮結果の形式が不正です`)
        const [, mediaType, base64] = match
        if (!ALLOWED_MIME_TYPES.has(mediaType)) throw new Error(`画像${i + 1}: 対応していない形式です`)
        if (seenDataUrls.has(dataUrl)) throw new Error(`画像${i + 1}: 同じ画像が重複しています`)
        seenDataUrls.add(dataUrl)

        const bytes = base64ByteLength(base64)
        if (bytes > MAX_IMAGE_BYTES) throw new Error(`画像${i + 1}: 圧縮後も容量が大きすぎます`)
        totalBytes += bytes
        if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error('画像の合計容量が上限を超えています')
      }

      const { data, error } = await supabase.functions.invoke('ocr-to-csv', {
        body: { images: base64Images },
      })

      if (error) {
        throw new Error(await resolveOcrErrorMessage(error))
      }

      // Edge Function 内のエラー（HTTP 200 + body.error のパターンも維持）
      if (data?.error) throw new Error(data.error)

      const extracted = (data?.rows ?? []).filter(r => r.date)
      if (!extracted.length) throw new Error('データを検出できませんでした。表1（体調・生活記録）が含まれる画像かご確認ください。')

      // 警告があれば保持
      if (data?.warnings?.length) {
        setOcrError(`⚠️ 一部の画像で取得失敗：\n${data.warnings.join('\n')}`)
      }

      setRows(extracted)
      setStep(2)
    } catch (err) {
      setOcrError(err.message)
      setStep(0)
    }
  }

  // ── セル編集 ──────────────────────────────────────────────
  function updateCell(rowIdx, key, value) {
    setRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, [key]: value } : r))
  }

  function addRow() {
    setRows(prev => [...prev, { date: '', morning_weight: '', night_weight: '',
      eating_out: '', period_day: '', bowel_movement: '',
      water_liters: '', toilet_count: '', sleep_hours: '' }])
  }

  function removeRow(idx) {
    setRows(prev => prev.filter((_, i) => i !== idx))
  }

  // ── CSVダウンロード ───────────────────────────────────────
  function handleDownloadCsv() {
    const csv = rowsToCsv(rows)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `ocr_export_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── インポート実行 ────────────────────────────────────────
  async function handleImport() {
    const validRows = rows.filter(r => r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    if (!validRows.length) return
    setImporting(true)
    try {
      const records = validRows.map(r => rowToWeightLog(r, id))
      const CHUNK = 100
      let imported = 0
      for (let i = 0; i < records.length; i += CHUNK) {
        const chunk = records.slice(i, i + CHUNK)
        const { error } = await supabase
          .from('weight_logs')
          .upsert(chunk, { onConflict: 'client_id,date' })
        if (error) throw error
        imported += chunk.length
      }
      setImportResult({ imported, total: validRows.length })
      setStep(3)
    } catch (err) {
      setOcrError(`インポートエラー: ${err.message}`)
    } finally {
      setImporting(false)
    }
  }

  // ── 日付バリデーション表示 ────────────────────────────────
  function isValidDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v ?? '') }

  // ── レンダリング ──────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">

      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <BackButton to={`/admin/clients/${id}`} label="顧客詳細に戻る" variant="dark" />
          <div>
            <h1 className="text-lg font-bold text-gray-800">🖼️ 画像からCSV作成・インポート</h1>
            <p className="text-xs text-gray-400">スクリーンショット → OCR解析 → プレビュー編集 → Supabase保存</p>
          </div>
        </div>
      </header>

      {/* ステップバー */}
      <div className="bg-white border-b border-gray-100 px-6 py-3">
        <div className="flex items-center gap-1.5 max-w-3xl mx-auto overflow-x-auto">
          {[STEPS[0], STEPS[2], STEPS[3]].map((label, i) => {
            const s = i === 0 ? 0 : i === 1 ? 2 : 3
            return (
              <div key={i} className="flex items-center gap-1.5 flex-shrink-0">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                  ${step > s ? 'bg-green-500 text-white'
                  : step === s || (s === 0 && step === 1) ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-400'}`}>
                  {step > s ? '✓' : i + 1}
                </div>
                <span className={`text-xs font-medium whitespace-nowrap
                  ${step === s || (s === 0 && step === 1) ? 'text-blue-700'
                  : step > s ? 'text-green-600' : 'text-gray-400'}`}>
                  {label}
                </span>
                {i < 2 && <span className="text-gray-300 mx-0.5">›</span>}
              </div>
            )
          })}
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* エラー表示 */}
        {ocrError && (
          <div className={`border rounded-xl px-5 py-4 flex items-start gap-3
            ${ocrError.startsWith('⚠️') ? 'bg-orange-50 border-orange-200' : 'bg-red-50 border-red-200'}`}>
            <span className="text-xl flex-shrink-0">{ocrError.startsWith('⚠️') ? '⚠️' : '❌'}</span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold mb-1 ${ocrError.startsWith('⚠️') ? 'text-orange-700' : 'text-red-700'}`}>
                {ocrError.startsWith('⚠️') ? '一部の画像で警告があります' : 'エラーが発生しました'}
              </p>
              {/* 改行を <br> に変換して表示 */}
              <div className={`text-sm whitespace-pre-line ${ocrError.startsWith('⚠️') ? 'text-orange-600' : 'text-red-600'}`}>
                {ocrError.replace(/^⚠️\s*/, '')}
              </div>
            </div>
            <button onClick={() => setOcrError(null)} className="flex-shrink-0 text-gray-300 hover:text-gray-500 text-lg">✕</button>
          </div>
        )}

        {/* ══ STEP 0: 画像アップロード ═══════════════════════════ */}
        {step === 0 && (
          <>
            {/* 説明 */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 text-sm text-blue-700">
              <p className="font-bold mb-1">📱 対応画像</p>
              <p>体重管理アプリの「表1（体調・生活記録）」が含まれるスクリーンショット。複数枚同時にアップロードできます。</p>
              <p className="mt-1 text-blue-500 text-xs">※ グラフ部分・表2は自動的に無視されます</p>
            </div>

            {/* ドロップ領域 */}
            <div
              ref={dropRef}
              className={`bg-white rounded-xl border-2 border-dashed transition-colors p-10 flex flex-col items-center gap-4 cursor-pointer
                ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-300'}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="text-5xl select-none">🖼️</div>
              <div className="text-center">
                <p className="text-base font-bold text-gray-700">
                  {isDragging ? 'ドロップしてください' : '画像をドロップ、またはクリックして選択'}
                </p>
                <p className="text-sm text-gray-400 mt-1">JPG・PNG・WebP対応　複数選択可</p>
              </div>
              <button type="button"
                className="px-6 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 text-sm">
                画像を選ぶ
              </button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden"
                onChange={e => addImages(e.target.files)} />
            </div>

            {/* 選択済み画像リスト */}
            {images.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-gray-700">選択中の画像 ({images.length}枚)</h2>
                  <button onClick={() => setImages([])}
                    className="text-xs text-red-400 hover:text-red-600">すべて削除</button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {images.map((img, i) => (
                    <div key={i} className="relative group">
                      <img src={img.previewUrl} alt={img.name}
                        className="w-full aspect-video object-cover rounded-lg border border-gray-200" />
                      <button
                        onClick={() => removeImage(i)}
                        className="absolute top-1 right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        ✕
                      </button>
                      <p className="text-xs text-gray-400 mt-1 truncate">{img.name}</p>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleOcr}
                  className="mt-5 w-full py-3.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors text-sm">
                  🔍 OCR解析を開始 ({images.length}枚)
                </button>
              </div>
            )}
          </>
        )}

        {/* ══ STEP 1: OCR中 ══════════════════════════════════════ */}
        {step === 1 && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 flex flex-col items-center gap-5">
            <div className="w-14 h-14 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            <div className="text-center">
              <p className="text-lg font-bold text-gray-700">OCR解析中…</p>
              <p className="text-sm text-gray-400 mt-1">Claude AIが画像から表データを読み取っています</p>
              <p className="text-xs text-gray-300 mt-2">画像{images.length}枚 / 処理に10〜30秒かかることがあります</p>
            </div>
          </div>
        )}

        {/* ══ STEP 2: プレビュー・編集 ════════════════════════════ */}
        {step === 2 && (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                  <h2 className="text-sm font-bold text-gray-700">📊 OCR結果プレビュー</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {rows.length}行を検出 ／ 各セルを直接クリックして編集できます
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleDownloadCsv}
                    className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
                    ⬇️ CSVダウンロード
                  </button>
                  <button onClick={() => { setStep(0); setOcrError(null) }}
                    className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
                    やり直す
                  </button>
                </div>
              </div>

              {/* 編集可能テーブル */}
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="text-xs w-full border-collapse">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-2 text-gray-400 font-medium border-b border-gray-200 w-8">#</th>
                      {COLS.map(c => (
                        <th key={c.key} className={`px-2 py-2 text-left text-gray-500 font-semibold border-b border-gray-200 whitespace-nowrap ${c.w}`}>
                          {c.label}
                        </th>
                      ))}
                      <th className="px-2 py-2 border-b border-gray-200 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, ri) => (
                      <tr key={ri}
                        className={`${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}
                          ${!isValidDate(row.date) ? 'bg-red-50/60' : ''}`}>
                        <td className="px-2 py-1 text-center text-gray-300 font-mono">{ri + 1}</td>
                        {COLS.map(c => (
                          <td key={c.key} className={`px-1 py-0.5 ${c.w}`}>
                            <EditCell
                              value={row[c.key]}
                              onChange={v => updateCell(ri, c.key, v)}
                              placeholder={c.ph}
                            />
                          </td>
                        ))}
                        <td className="px-1 py-1 text-center">
                          <button onClick={() => removeRow(ri)}
                            className="text-gray-300 hover:text-red-400 transition-colors text-base leading-none">
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 行追加 */}
              <button onClick={addRow}
                className="mt-2 w-full py-2 text-xs text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg border border-dashed border-gray-200 transition-colors">
                ＋ 行を追加
              </button>

              {/* 凡例 */}
              <div className="mt-3 text-xs text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
                <span>外食: M=朝/L=昼/D=夕（例: LD）</span>
                <span>生理・排便: true または ○</span>
                <span>水分: リットル単位（例: 1.5）</span>
                <span className="text-red-400">赤背景 = 日付エラー（修正が必要）</span>
              </div>
            </div>

            {/* インポートボタン */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-bold text-gray-700">
                  {rows.filter(r => isValidDate(r.date)).length}件をインポート
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  同じ日付が既に存在する場合はCSVデータで上書きされます
                </p>
              </div>
              <button
                onClick={handleImport}
                disabled={importing || !rows.some(r => isValidDate(r.date))}
                className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm">
                {importing ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    インポート中…
                  </span>
                ) : 'この内容をインポート'}
              </button>
            </div>
          </>
        )}

        {/* ══ STEP 3: 完了 ════════════════════════════════════════ */}
        {step === 3 && importResult && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center space-y-5">
            <div className="text-6xl">✅</div>
            <h2 className="text-2xl font-bold text-green-600">インポート完了！</h2>
            <div className="flex justify-center gap-8">
              <div>
                <p className="text-4xl font-black text-blue-600">{importResult.imported}</p>
                <p className="text-sm text-gray-500 mt-1">件 登録・更新</p>
              </div>
            </div>
            <p className="text-sm text-gray-400">体重グラフと月間表に反映されました</p>
            <div className="flex gap-3 justify-center pt-2">
              <button
                onClick={() => { setStep(0); setImages([]); setRows([]); setImportResult(null) }}
                className="px-6 py-3 bg-white border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50">
                別の画像をインポート
              </button>
              <button
                onClick={() => navigate(`/admin/clients/${id}`)}
                className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700">
                顧客詳細に戻る
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
