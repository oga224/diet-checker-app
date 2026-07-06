import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import BackButton from '../../components/BackButton'

// ── CSV パース ──────────────────────────────────────────────────

/**
 * RFC 4180 準拠の簡易CSVパーサー（引用符対応）
 */
function parseCSVLine(line) {
  const fields = []
  let i = 0
  while (i < line.length) {
    if (line[i] === '"') {
      let val = ''
      i++
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2 }
        else if (line[i] === '"') { i++; break }
        else { val += line[i++] }
      }
      fields.push(val)
      if (line[i] === ',') i++
    } else {
      const end = line.indexOf(',', i)
      if (end === -1) { fields.push(line.slice(i)); break }
      fields.push(line.slice(i, end))
      i = end + 1
    }
  }
  return fields
}

function parseFloatOrNull(v) {
  if (!v || v.trim() === '') return null
  const n = parseFloat(v.trim())
  return isNaN(n) ? null : n
}

function parseIntOrNull(v) {
  if (!v || v.trim() === '') return null
  const n = parseInt(v.trim(), 10)
  return isNaN(n) ? null : n
}

/**
 * true / ○ / ◯ / 有 / あり / 1 / yes → true
 * false / × / 無 / なし / 0 / no → false
 * 空欄 → null
 */
function parseBoolOrNull(v) {
  if (!v || v.trim() === '') return null
  const s = v.trim().toLowerCase()
  if (['true', '○', '◯', '1', 'yes', '有', 'あり'].includes(s)) return true
  if (['false', '×', '0', 'no', '無', 'なし'].includes(s)) return false
  return null
}

/**
 * eating_out 列を ate_out_breakfast / ate_out_lunch / ate_out_dinner に変換
 * 例: "LM" → lunch=true, breakfast=true
 *     "true" or "○" → 全て true
 *     "" → 全て false
 */
function parseEatingOut(v) {
  if (!v || v.trim() === '') {
    return { ate_out_breakfast: false, ate_out_lunch: false, ate_out_dinner: false }
  }
  const s = v.trim().toUpperCase()
  if (s === 'TRUE' || s === '○' || s === '1') {
    return { ate_out_breakfast: true, ate_out_lunch: true, ate_out_dinner: true }
  }
  return {
    ate_out_breakfast: s.includes('M') || s.includes('B') || s.includes('朝'),
    ate_out_lunch:     s.includes('L') || s.includes('昼'),
    ate_out_dinner:    s.includes('D') || s.includes('夜') || s.includes('E'),
  }
}

/**
 * 水分量を ml に変換して返す
 * lVal: water_liters 列の値（L単位 → ×1000）
 * mlVal: water_ml 列の値（ml単位 → そのまま使用）
 * どちらか一方だけ渡す。値が100以上なら ml と判断（安全ガード）
 */
function parseWaterToMl(lVal, mlVal) {
  // water_liters 列が優先
  const lStr = lVal?.trim()
  if (lStr && lStr !== '') {
    const n = parseFloatOrNull(lStr)
    if (n === null) return null
    // 安全ガード: 100以上はすでにmlと判断（例: 1300 を誤って liters 列に入れた場合）
    return n >= 100 ? Math.round(n) : Math.round(n * 1000)
  }
  // water_ml 列（ml単位 → そのまま使用）
  const mlStr = mlVal?.trim()
  if (mlStr && mlStr !== '') {
    const n = parseFloatOrNull(mlStr)
    if (n === null) return null
    // 安全ガード: 100未満はリットル単位と判断（例: 1.3 を ml 列に入れた場合）
    return n < 100 ? Math.round(n * 1000) : Math.round(n)
  }
  return null
}

/**
 * 1行のデータを weight_logs 形式に変換
 * headers は列名リスト（ユーザー定義の順序に対応）
 */
function transformRow(rowMap, rowNum) {
  const date = rowMap.date?.trim() ?? ''
  if (!date) throw new Error('date が空欄です')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`日付の形式が不正です（YYYY-MM-DD が必要）: "${date}"`)
  }

  const morningKg = parseFloatOrNull(rowMap.morning_weight ?? rowMap.morning_kg)
  const eveningKg = parseFloatOrNull(rowMap.night_weight   ?? rowMap.evening_kg)

  if (morningKg !== null && (morningKg < 20 || morningKg > 300)) {
    throw new Error(`朝体重の値が不正です: ${morningKg}`)
  }
  if (eveningKg !== null && (eveningKg < 20 || eveningKg > 300)) {
    throw new Error(`夜体重の値が不正です: ${eveningKg}`)
  }

  const waterMl    = parseWaterToMl(rowMap.water_liters, rowMap.water_ml)
  const toiletCnt  = parseIntOrNull(rowMap.toilet_count)
  const sleepHours = parseFloatOrNull(rowMap.sleep_hours)

  return {
    date,
    morning_kg:        morningKg,
    evening_kg:        eveningKg,
    ...parseEatingOut(rowMap.eating_out),
    menstruation:      parseBoolOrNull(rowMap.period_day ?? rowMap.menstruation),
    bowel_movement:    parseBoolOrNull(rowMap.bowel_movement),
    water_ml:          waterMl,
    toilet_count:      toiletCnt,
    sleep_hours:       sleepHours,
    comment:           rowMap.comment?.trim() || null,
  }
}

/**
 * CSVテキスト全体を解析して行リストとエラーリストを返す
 */
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n')
  if (lines.length < 2) return { rows: [], errors: [{ rowNum: 1, message: 'データ行がありません' }] }

  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase())
  if (!headers.includes('date')) {
    return { rows: [], errors: [{ rowNum: 1, message: 'ヘッダー行に "date" 列が見つかりません' }] }
  }

  const rows = []
  const errors = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const values  = parseCSVLine(line)
    const rowMap  = {}
    headers.forEach((h, idx) => { rowMap[h] = values[idx] ?? '' })

    // [DEBUG] CSV読み取り後の生データ
    console.log(`[CSV parse] 行${i + 1} 生データ:`, rowMap)

    try {
      const record = transformRow(rowMap, i + 1)
      // [DEBUG] transformRow後の変換済みデータ
      console.log(`[CSV parse] 行${i + 1} 変換後:`, record)
      rows.push({ _rowNum: i + 1, _original: line, ...record })
    } catch (e) {
      errors.push({ rowNum: i + 1, message: e.message, original: line })
    }
  }

  return { rows, errors }
}

// ── UI コンポーネント ─────────────────────────────────────────

function Badge({ children, color = 'gray' }) {
  const colors = {
    gray:   'bg-gray-100 text-gray-600',
    green:  'bg-green-100 text-green-700',
    red:    'bg-red-100 text-red-600',
    blue:   'bg-blue-100 text-blue-700',
    orange: 'bg-orange-100 text-orange-700',
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[color]}`}>
      {children}
    </span>
  )
}

/** 体重・リットルなどを表示用に整形 */
function fmt(val, unit = '') {
  if (val === null || val === undefined) return <span className="text-gray-300">—</span>
  return <span>{val}{unit}</span>
}

function fmtBool(val) {
  if (val === true)  return <span className="text-green-600">○</span>
  if (val === false) return <span className="text-gray-300">—</span>
  return <span className="text-gray-300">—</span>
}

function fmtEat(b, l, d) {
  const parts = []
  if (b) parts.push('M')
  if (l) parts.push('L')
  if (d) parts.push('D')
  return parts.length ? <span className="text-orange-600 font-medium">{parts.join('')}</span> : <span className="text-gray-300">—</span>
}

// ── メインコンポーネント ──────────────────────────────────────

const STEPS = ['ファイル選択', 'プレビュー確認', 'インポート完了']

export default function ClientCsvImportPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const fileRef  = useRef(null)

  const [step,         setStep]         = useState(0)        // 0=upload 1=preview 2=done
  const [fileName,     setFileName]     = useState('')
  const [parsed,       setParsed]       = useState(null)     // { rows, errors }
  const [conflictMode, setConflictMode] = useState('overwrite') // 'overwrite' | 'skip'
  const [importing,    setImporting]    = useState(false)
  const [result,       setResult]       = useState(null)     // { imported, skipped, failed }
  const [parseError,   setParseError]   = useState(null)
  const [clientName,   setClientName]   = useState('')

  // クライアント名を取得
  useState(() => {
    supabase.from('clients').select('name').eq('id', id).single()
      .then(({ data }) => { if (data) setClientName(data.name) })
  }, [id])

  // ── ファイル選択 ─────────────────────────────────────────────
  function handleFile(file) {
    if (!file) return
    setParseError(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target.result
        const result = parseCSV(text)
        setFileName(file.name)
        setParsed(result)
        setStep(1)
      } catch (err) {
        setParseError(`ファイルの読み込みに失敗しました: ${err.message}`)
      }
    }
    reader.onerror = () => setParseError('ファイルを読み込めませんでした')
    reader.readAsText(file, 'UTF-8')
  }

  function handleDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  // ── インポート実行 ─────────────────────────────────────────
  async function handleImport() {
    if (!parsed?.rows.length) return
    setImporting(true)

    const validRows = parsed.rows.map(r => {
      const { _rowNum, _original, ...record } = r
      return { ...record, client_id: id }
    })

    // ── [DEBUG] 保存直前のデータを確認 ────────────────────────
    console.log('[CSVインポート] ① transformRow後の全行データ:')
    validRows.forEach((r, i) => {
      console.log(`  行${i + 1}:`, {
        date: r.date,
        morning_kg: r.morning_kg,
        evening_kg: r.evening_kg,
        menstruation: r.menstruation,
        bowel_movement: r.bowel_movement,
        water_ml: r.water_ml,
        toilet_count: r.toilet_count,
        sleep_hours: r.sleep_hours,
      })
    })

    let imported = 0, skipped = 0, failed = 0

    try {
      if (conflictMode === 'skip') {
        const dates = validRows.map(r => r.date)
        const { data: existing } = await supabase
          .from('weight_logs')
          .select('date')
          .eq('client_id', id)
          .in('date', dates)

        const existingDates = new Set((existing ?? []).map(r => r.date))
        const newRows = validRows.filter(r => !existingDates.has(r.date))
        skipped = validRows.length - newRows.length
        console.log('[CSVインポート] ② skipモード - 既存日付:', [...existingDates], '→ 新規挿入:', newRows.length, '件')

        if (newRows.length > 0) {
          const { data: insData, error } = await supabase.from('weight_logs').insert(newRows).select()
          console.log('[CSVインポート] ③ insert結果:', { insData, error })
          if (error) throw error
          imported = newRows.length
        }
      } else {
        // overwrite: upsert (UNIQUE constraint on client_id + date が必要)
        const CHUNK = 100
        for (let i = 0; i < validRows.length; i += CHUNK) {
          const chunk = validRows.slice(i, i + CHUNK)
          console.log('[CSVインポート] ② upsert送信データ:', chunk)
          const { data: upsData, error } = await supabase
            .from('weight_logs')
            .upsert(chunk, { onConflict: 'client_id,date' })
            .select()
          console.log('[CSVインポート] ③ upsert結果:', { upsData, error })
          if (error) {
            // UNIQUE制約がない場合のわかりやすいエラーメッセージ
            if (error.message?.includes('unique') || error.message?.includes('constraint') || error.code === '42P10') {
              throw new Error(
                'DBにUNIQUE制約が設定されていません。\n' +
                'Supabase SQL Editor で supabase_weight_logs_unique_fix.sql を実行してから再試行してください。\n\n' +
                `詳細: ${error.message}`
              )
            }
            throw error
          }
          imported += chunk.length
        }
      }

      // ── [DEBUG] 保存後にDBから取得して確認 ──────────────────
      const importedDates = validRows.map(r => r.date)
      const { data: savedData } = await supabase
        .from('weight_logs')
        .select('date,morning_kg,menstruation,bowel_movement,water_ml')
        .eq('client_id', id)
        .in('date', importedDates)
      console.log('[CSVインポート] ④ 保存後DBから取得:', savedData)

      setResult({ imported, skipped, failed })
      setStep(2)
    } catch (err) {
      console.error('[CSVインポート] エラー:', err)
      setResult({ imported, skipped, failed: validRows.length - imported - skipped, errorMessage: err.message })
      setStep(2)
    } finally {
      setImporting(false)
    }
  }

  // ── レンダリング ──────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <BackButton to={`/admin/clients/${id}`} label="顧客詳細に戻る" variant="dark" />
          <div>
            <h1 className="text-lg font-bold text-gray-800">CSVインポート</h1>
            {clientName && <p className="text-xs text-gray-400">{clientName} さんのデータ一括登録</p>}
          </div>
        </div>
      </header>

      {/* ステップインジケーター */}
      <div className="bg-white border-b border-gray-100 px-6 py-3">
        <div className="flex items-center gap-2 max-w-2xl mx-auto">
          {STEPS.map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                ${i < step ? 'bg-green-500 text-white' : i === step ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-400'}`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className={`text-sm font-medium ${i === step ? 'text-blue-700' : i < step ? 'text-green-600' : 'text-gray-400'}`}>
                {label}
              </span>
              {i < STEPS.length - 1 && <span className="text-gray-300 text-sm mx-1">›</span>}
            </div>
          ))}
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {/* ══ STEP 0: ファイル選択 ═══════════════════════════════ */}
        {step === 0 && (
          <>
            {/* CSV形式説明 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-bold text-gray-700 mb-3">📋 対応CSVフォーマット</h2>
              <div className="bg-gray-50 rounded-lg p-4 overflow-x-auto">
                <p className="text-xs font-mono text-gray-500 whitespace-nowrap">
                  date,morning_weight,night_weight,eating_out,period_day,bowel_movement,water_liters,toilet_count,sleep_hours
                </p>
                <p className="text-xs font-mono text-blue-600 mt-1 whitespace-nowrap">
                  2026-03-05,69.5,70.0,L,true,true,1.7,7,6
                </p>
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-500">
                <div>• <strong>日付</strong>: YYYY-MM-DD 形式</div>
                <div>• <strong>体重</strong>: 数値（kg）</div>
                <div>• <strong>eating_out</strong>: M=朝/L=昼/D=夕 の組み合わせ（例: LD）、または ○/true で全て</div>
                <div>• <strong>boolean列</strong>: true/false または ○/×</div>
                <div>• <strong>水分</strong>: リットル単位（例: 1.7 → 1700ml）</div>
                <div>• <strong>空欄</strong>: null として扱います</div>
              </div>

              {/* comment 列もサポート */}
              <p className="mt-3 text-xs text-gray-400">
                ※ 列の順番は自由です。ヘッダー行の列名で自動判定します。<br />
                ※ <code className="bg-gray-100 px-1 rounded">comment</code> 列を追加することもできます。
              </p>
            </div>

            {/* ファイルドロップ */}
            <div
              className="bg-white rounded-xl border-2 border-dashed border-gray-300 hover:border-blue-400 transition-colors p-10 flex flex-col items-center gap-4 cursor-pointer"
              onClick={() => fileRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
            >
              <div className="text-5xl">📂</div>
              <div className="text-center">
                <p className="text-base font-bold text-gray-700">CSVファイルをドロップ</p>
                <p className="text-sm text-gray-400 mt-1">または クリックして選択</p>
              </div>
              <button
                type="button"
                className="px-6 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors text-sm"
              >
                ファイルを選ぶ
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={e => handleFile(e.target.files?.[0])}
              />
            </div>

            {parseError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">
                ⚠️ {parseError}
              </div>
            )}
          </>
        )}

        {/* ══ STEP 1: プレビュー ═════════════════════════════════ */}
        {step === 1 && parsed && (
          <>
            {/* サマリー */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-bold text-gray-700">📄 {fileName}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">プレビュー（上位20行表示）</p>
                </div>
                <div className="flex gap-2">
                  <Badge color={parsed.rows.length > 0 ? 'green' : 'gray'}>
                    {parsed.rows.length}行 正常
                  </Badge>
                  {parsed.errors.length > 0 && (
                    <Badge color="red">{parsed.errors.length}行 エラー</Badge>
                  )}
                </div>
              </div>

              {/* エラー一覧 */}
              {parsed.errors.length > 0 && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
                  <p className="text-xs font-bold text-red-700">⚠️ エラーのある行（スキップされます）</p>
                  {parsed.errors.map((e, i) => (
                    <div key={i} className="text-xs text-red-600">
                      <span className="font-mono font-bold">{e.rowNum}行目</span>: {e.message}
                      <span className="text-red-400 ml-2 font-mono">{e.original?.slice(0, 60)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* プレビューテーブル */}
              {parsed.rows.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="text-xs w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        {['行', '日付', '朝体重', '夜体重', '外食', '生理', '排便', '水分', 'トイレ', '睡眠'].map(h => (
                          <th key={h} className="px-2.5 py-2 text-left font-semibold text-gray-500 whitespace-nowrap border-b border-gray-200">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.rows.slice(0, 20).map((row, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                          <td className="px-2.5 py-1.5 text-gray-400 font-mono">{row._rowNum}</td>
                          <td className="px-2.5 py-1.5 font-medium text-gray-700 whitespace-nowrap">{row.date}</td>
                          <td className="px-2.5 py-1.5">{fmt(row.morning_kg, 'kg')}</td>
                          <td className="px-2.5 py-1.5">{fmt(row.evening_kg, 'kg')}</td>
                          <td className="px-2.5 py-1.5">{fmtEat(row.ate_out_breakfast, row.ate_out_lunch, row.ate_out_dinner)}</td>
                          <td className="px-2.5 py-1.5">{fmtBool(row.menstruation)}</td>
                          <td className="px-2.5 py-1.5">{fmtBool(row.bowel_movement)}</td>
                          <td className="px-2.5 py-1.5">{row.water_ml != null ? `${(row.water_ml/1000).toFixed(1)}L` : <span className="text-gray-300">—</span>}</td>
                          <td className="px-2.5 py-1.5">{fmt(row.toilet_count, '回')}</td>
                          <td className="px-2.5 py-1.5">{fmt(row.sleep_hours, 'h')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsed.rows.length > 20 && (
                    <p className="text-center text-xs text-gray-400 py-2 border-t border-gray-200">
                      …残り {parsed.rows.length - 20} 行（インポート対象に含まれます）
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500 text-center py-6">インポートできる行がありません</p>
              )}
            </div>

            {/* 競合オプション */}
            {parsed.rows.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-sm font-bold text-gray-700 mb-3">⚙️ 同じ日付のデータが既にある場合</h2>
                <div className="flex flex-col gap-3">
                  {[
                    { value: 'overwrite', label: '上書きする', desc: 'CSVのデータで既存データを更新します', color: 'border-blue-400 bg-blue-50' },
                    { value: 'skip',      label: 'スキップする', desc: '既存データがある日付はスキップします', color: 'border-gray-300 bg-gray-50' },
                  ].map(opt => (
                    <label key={opt.value}
                      className={`flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-colors
                        ${conflictMode === opt.value ? opt.color : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                    >
                      <input
                        type="radio"
                        name="conflict"
                        value={opt.value}
                        checked={conflictMode === opt.value}
                        onChange={() => setConflictMode(opt.value)}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-sm font-bold text-gray-700">{opt.label}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* アクションボタン */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setParsed(null); setFileName(''); setStep(0) }}
                className="flex-1 py-3.5 bg-white border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-colors"
              >
                やり直す
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={importing || parsed.rows.length === 0}
                className="flex-2 px-8 py-3.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {importing ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
                    インポート中…
                  </span>
                ) : `${parsed.rows.length}件をインポートする`}
              </button>
            </div>
          </>
        )}

        {/* ══ STEP 2: 完了 ═══════════════════════════════════════ */}
        {step === 2 && result && (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center space-y-5">
            {result.errorMessage ? (
              <>
                <div className="text-5xl">⚠️</div>
                <h2 className="text-xl font-bold text-red-600">インポートに失敗しました</h2>
                <p className="text-sm text-gray-500 bg-red-50 rounded-xl p-4 text-left">{result.errorMessage}</p>
                <p className="text-xs text-gray-400">
                  ※ weight_logsテーブルに (client_id, date) のUNIQUE制約が必要です。<br />
                  Supabase SQL Editorで <code className="bg-gray-100 px-1 rounded">supabase_weight_logs_unique_fix.sql</code> を実行してください。
                </p>
              </>
            ) : (
              <>
                <div className="text-6xl">✅</div>
                <h2 className="text-2xl font-bold text-green-600">インポート完了！</h2>
                <div className="flex justify-center gap-6 text-sm">
                  <div className="text-center">
                    <p className="text-3xl font-black text-blue-600">{result.imported}</p>
                    <p className="text-gray-500">件 登録</p>
                  </div>
                  {result.skipped > 0 && (
                    <div className="text-center">
                      <p className="text-3xl font-black text-gray-400">{result.skipped}</p>
                      <p className="text-gray-500">件 スキップ</p>
                    </div>
                  )}
                  {result.failed > 0 && (
                    <div className="text-center">
                      <p className="text-3xl font-black text-red-400">{result.failed}</p>
                      <p className="text-gray-500">件 失敗</p>
                    </div>
                  )}
                </div>
                <p className="text-sm text-gray-400">体重グラフと月間表に反映されました</p>
              </>
            )}

            <div className="flex gap-3 justify-center pt-2">
              <button
                type="button"
                onClick={() => { setParsed(null); setFileName(''); setStep(0); setResult(null) }}
                className="px-6 py-3 bg-white border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50"
              >
                別のCSVをインポート
              </button>
              <button
                type="button"
                onClick={() => navigate(`/admin/clients/${id}`)}
                className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700"
              >
                顧客詳細に戻る
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
