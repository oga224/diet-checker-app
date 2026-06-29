import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import { supabase }    from '../../lib/supabase'
import PhotoUpload     from '../../components/PhotoUpload'
import EvaluationCard  from '../../components/EvaluationCard'
import { isValidWeight, filterWeightInput, WEIGHT_ERROR_MSG } from '../../lib/weightValidator'

// ─────────────────────────────────────────────────────────────
// フォーム初期値
// ─────────────────────────────────────────────────────────────
const EMPTY = {
  morning_kg: '', evening_kg: '',
  water_ml: '', toilet_count: '', sleep_hours: '',
  bowel_movement: null, menstruation: null,
  ate_breakfast: null, ate_lunch: null, ate_dinner: null, ate_snack: null,
  ate_out_breakfast: false, ate_out_lunch: false, ate_out_dinner: false,
  comment: '',
}
const EMPTY_PHOTOS = { breakfast: null, lunch: null, dinner: null, snack: null }

// ─────────────────────────────────────────────────────────────
// 区切りヘッダー
// ─────────────────────────────────────────────────────────────
function SectionHeader({ emoji, label }) {
  return (
    <div className="flex items-center gap-2 pt-6 pb-3 border-t border-gray-100">
      <span className="text-2xl">{emoji}</span>
      <h2 className="text-lg font-bold text-gray-700">{label}</h2>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 体重入力（大きな数字）
// ─────────────────────────────────────────────────────────────
function WeightInput({ label, value, onChange }) {
  const invalid = value !== '' && !isValidWeight(value)

  function handleChange(raw) {
    const filtered = filterWeightInput(raw)
    if (filtered !== null) onChange(filtered)
    // null の場合は state を更新しない（入力拒否）
  }

  return (
    <div className="mb-5">
      <p className="text-base font-bold text-gray-600 mb-2">{label}</p>
      <div className="flex items-end gap-3">
        <input
          type="number"
          inputMode="decimal"
          step="0.1" min="20" max="300"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="--.-"
          className={`text-5xl font-black text-center bg-gray-50 border-b-4 outline-none flex-1 min-w-0 py-2 rounded-t-xl
            ${invalid
              ? 'border-red-400 text-red-500 focus:border-red-500'
              : 'border-blue-300 text-gray-800 focus:border-blue-500'}`}
        />
        <span className="text-2xl font-bold text-gray-400 mb-2 flex-shrink-0">kg</span>
      </div>
      {invalid && (
        <p className="text-sm text-red-500 mt-1.5 font-medium">
          ⚠️ {WEIGHT_ERROR_MSG}
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 大きな2択ボタン（食べた/食べてない、あり/なし）
// ─────────────────────────────────────────────────────────────
function BigToggle({ label, value, onChange,
  trueLabel = 'あり', falseLabel = 'なし',
  trueColor = 'bg-blue-600', falseColor = 'bg-gray-500' }) {
  return (
    <div className="mb-4">
      <p className="text-base font-bold text-gray-700 mb-2">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onChange(value === true ? null : true)}
          className={`py-5 rounded-2xl text-xl font-bold transition-all active:scale-95
            ${value === true ? `${trueColor} text-white shadow-md` : 'bg-gray-100 text-gray-400'}`}
        >
          {trueLabel}
        </button>
        <button
          type="button"
          onClick={() => onChange(value === false ? null : false)}
          className={`py-5 rounded-2xl text-xl font-bold transition-all active:scale-95
            ${value === false ? `${falseColor} text-white shadow-md` : 'bg-gray-100 text-gray-400'}`}
        >
          {falseLabel}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 数値入力（水分・睡眠・トイレ）
// ─────────────────────────────────────────────────────────────
function NumberRow({ emoji, label, value, onChange, unit, min, max, step = '1', placeholder }) {
  return (
    <div className="py-4 border-b border-gray-100">
      <p className="text-base font-bold text-gray-600 mb-2">{emoji} {label}</p>
      <div className="flex items-end gap-3">
        <input
          type="number"
          inputMode="numeric"
          step={step} min={min} max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="text-4xl font-bold text-center text-gray-800 bg-gray-50 border-b-4 border-gray-300 focus:border-blue-400 outline-none flex-1 min-w-0 py-2 rounded-t-xl"
        />
        <span className="text-xl text-gray-400 font-bold mb-2 flex-shrink-0">{unit}</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// メインコンポーネント
// ─────────────────────────────────────────────────────────────
export default function ClientRecordPage() {
  const { id, date: urlDate } = useParams()
  const navigate = useNavigate()
  const todayActual = format(new Date(), 'yyyy-MM-dd')
  const recordDate  = urlDate || todayActual
  const isPastEntry = !!urlDate && urlDate < todayActual
  const [form,         setForm]         = useState(EMPTY)
  const [photos,       setPhotos]       = useState(EMPTY_PHOTOS)
  const [clientName,   setClientName]   = useState('')
  const [saving,       setSaving]       = useState(false)
  const [saved,        setSaved]        = useState(false)
  const [savedLog,     setSavedLog]     = useState(null)
  const [savedMealLog, setSavedMealLog] = useState(null)
  const [prevKg,       setPrevKg]       = useState(null)
  const [error,        setError]        = useState(null)
  const [existingLogId,  setExistingLogId]  = useState(null)
  const [existingMealId, setExistingMealId] = useState(null)

  const today      = recordDate
  const todayLabel = format(parseISO(recordDate), 'M月d日 (E)', { locale: ja })

  // 既存データ取得
  useEffect(() => {
    async function fetchInitial() {
      const [clientRes, logRes, mealRes, prevRes] = await Promise.all([
        supabase.from('clients').select('name').eq('id', id).single(),
        supabase.from('weight_logs').select('*').eq('client_id', id).eq('date', today).maybeSingle(),
        supabase.from('meal_logs').select('*').eq('client_id', id).eq('date', today).maybeSingle(),
        supabase.from('weight_logs').select('morning_kg').eq('client_id', id)
          .lt('date', today).order('date', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (!prevRes.error && prevRes.data) setPrevKg(prevRes.data.morning_kg)
      if (!clientRes.error) setClientName(clientRes.data?.name ?? '')
      if (!logRes.error && logRes.data) {
        const d = logRes.data
        setExistingLogId(d.id)
        setForm({
          morning_kg:        d.morning_kg        != null ? String(d.morning_kg)    : '',
          evening_kg:        d.evening_kg        != null ? String(d.evening_kg)    : '',
          water_ml:          d.water_ml          != null ? String(d.water_ml)      : '',
          toilet_count:      d.toilet_count      != null ? String(d.toilet_count)  : '',
          sleep_hours:       d.sleep_hours       != null ? String(d.sleep_hours)   : '',
          bowel_movement:    d.bowel_movement    ?? null,
          menstruation:      d.menstruation      ?? null,
          ate_breakfast:     d.ate_breakfast     ?? null,
          ate_lunch:         d.ate_lunch         ?? null,
          ate_dinner:        d.ate_dinner        ?? null,
          ate_snack:         d.ate_snack         ?? null,
          ate_out_breakfast: d.ate_out_breakfast ?? false,
          ate_out_lunch:     d.ate_out_lunch     ?? false,
          ate_out_dinner:    d.ate_out_dinner    ?? false,
          comment:           d.comment           ?? '',
        })
      }
      if (!mealRes.error && mealRes.data) {
        const m = mealRes.data
        setExistingMealId(m.id)
        setPhotos({
          breakfast: m.breakfast_photo_url ?? null,
          lunch:     m.lunch_photo_url     ?? null,
          dinner:    m.dinner_photo_url    ?? null,
          snack:     m.snack_photo_url     ?? null,
        })
      }
    }
    fetchInitial()
  }, [id, today])

  function set(field, value) { setForm((f) => ({ ...f, [field]: value })) }
  function setPhoto(key, url) { setPhotos((p) => ({ ...p, [key]: url })) }

  // 保存処理
  async function handleSubmit(e) {
    e.preventDefault()
    // 体重バリデーション（二重チェック）
    if (!isValidWeight(form.morning_kg)) {
      setError(`朝の体重：${WEIGHT_ERROR_MSG}`)
      return
    }
    if (!isValidWeight(form.evening_kg)) {
      setError(`夜の体重：${WEIGHT_ERROR_MSG}`)
      return
    }
    setSaving(true); setError(null)

    const weightPayload = {
      client_id:         id, date: today,
      morning_kg:        form.morning_kg    !== '' ? Number(form.morning_kg)    : null,
      evening_kg:        form.evening_kg    !== '' ? Number(form.evening_kg)    : null,
      water_ml:          form.water_ml      !== '' ? Number(form.water_ml)      : null,
      toilet_count:      form.toilet_count  !== '' ? Number(form.toilet_count)  : null,
      sleep_hours:       form.sleep_hours   !== '' ? Number(form.sleep_hours)   : null,
      bowel_movement:    form.bowel_movement,
      menstruation:      form.menstruation,
      ate_breakfast:     form.ate_breakfast,
      ate_lunch:         form.ate_lunch,
      ate_dinner:        form.ate_dinner,
      ate_snack:         form.ate_snack,
      ate_out_breakfast: form.ate_out_breakfast,
      ate_out_lunch:     form.ate_out_lunch,
      ate_out_dinner:    form.ate_out_dinner,
      comment:           form.comment.trim() || null,
    }
    const mealPayload = {
      client_id:           id, date: today,
      breakfast_photo_url: photos.breakfast,
      lunch_photo_url:     photos.lunch,
      dinner_photo_url:    photos.dinner,
      snack_photo_url:     photos.snack,
    }

    const [weightRes, mealRes] = await Promise.all([
      existingLogId
        ? supabase.from('weight_logs').update(weightPayload).eq('id', existingLogId)
        : supabase.from('weight_logs').insert(weightPayload),
      existingMealId
        ? supabase.from('meal_logs').update(mealPayload).eq('id', existingMealId)
        : supabase.from('meal_logs').insert(mealPayload),
    ])

    setSaving(false)
    if (weightRes.error || mealRes.error) {
      setError(`保存できませんでした：${(weightRes.error ?? mealRes.error).message}`)
    } else {
      setSavedLog(weightPayload)
      setSavedMealLog(mealPayload)
      setSaved(true)
    }
  }

  // ── 送信完了画面 ──────────────────────────────────────────
  if (saved) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white pb-12">
        <div className="max-w-md mx-auto px-5 pt-10 space-y-6">
          <div className="text-center">
            <div className="text-7xl mb-4">✅</div>
            <h2 className="text-3xl font-black text-green-600 mb-1">送信しました！</h2>
            <p className="text-lg text-gray-500">{todayLabel}の記録を保存しました</p>
          </div>
          {savedLog && <EvaluationCard log={savedLog} prevKg={prevKg} mealLog={savedMealLog} />}
          <Link to={`/client/${id}`}
            className="block w-full bg-blue-600 text-white text-2xl font-bold py-6 rounded-2xl shadow-md text-center">
            トップに戻る
          </Link>
          <Link to={`/client/${id}/history`}
            className="block w-full bg-white text-gray-600 text-xl font-bold py-5 rounded-2xl shadow-sm border border-gray-200 text-center">
            記録を見る
          </Link>
        </div>
      </div>
    )
  }

  // 写真パス
  const photoPath = (meal) => `${id}/${today}/${meal}.jpg`

  // ── 入力画面 ──────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white pb-20 overflow-x-hidden">
      {/* ヘッダー */}
      <header className="bg-blue-600 text-white px-5 py-5 shadow-md">
        <div className="flex items-center gap-3 mb-1">
          <button
            type="button"
            onClick={() => isPastEntry ? navigate(`/client/${id}/calendar`) : navigate(`/client/${id}`)}
            className="text-blue-200 text-2xl p-1"
          >‹</button>
          <p className="text-blue-100 text-lg">{todayLabel}</p>
          {isPastEntry && (
            <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full">過去日</span>
          )}
        </div>
        <h1 className="text-2xl font-bold pl-9">
          {clientName ? `${clientName} さんの記録` : '記録入力'}
        </h1>
      </header>

      <form onSubmit={handleSubmit} className="max-w-md mx-auto px-5">

        {/* ══ 1. 体重 ══════════════════════════════════════ */}
        <SectionHeader emoji="⚖️" label="体重" />
        <WeightInput label="🌅 朝の体重" value={form.morning_kg}
          onChange={(v) => set('morning_kg', v)} />
        <WeightInput label="🌙 夜の体重" value={form.evening_kg}
          onChange={(v) => set('evening_kg', v)} />

        {/* ══ 2. 食事 ══════════════════════════════════════ */}
        <SectionHeader emoji="🍽️" label="食事" />
        <BigToggle label="🍳 朝ごはん" value={form.ate_breakfast}
          onChange={(v) => set('ate_breakfast', v)}
          trueLabel="食べた" falseLabel="食べてない" falseColor="bg-gray-400" />
        <BigToggle label="🍱 昼ごはん" value={form.ate_lunch}
          onChange={(v) => set('ate_lunch', v)}
          trueLabel="食べた" falseLabel="食べてない" falseColor="bg-gray-400" />
        <BigToggle label="🍚 夜ごはん" value={form.ate_dinner}
          onChange={(v) => set('ate_dinner', v)}
          trueLabel="食べた" falseLabel="食べてない" falseColor="bg-gray-400" />
        <BigToggle label="🍰 間食" value={form.ate_snack}
          onChange={(v) => set('ate_snack', v)}
          trueLabel="あり" falseLabel="なし" falseColor="bg-gray-400" />

        {/* ══ 3. 食事写真 ═══════════════════════════════════ */}
        <SectionHeader emoji="📷" label="食事の写真（任意）" />
        <div className="grid grid-cols-4 gap-2 mb-2">
          {[
            { key: 'breakfast', label: '朝' },
            { key: 'lunch',     label: '昼' },
            { key: 'dinner',    label: '夜' },
            { key: 'snack',     label: '間食' },
          ].map(({ key, label }) => (
            <PhotoUpload
              key={key}
              label={label}
              bucket="meal-photos"
              storagePath={photoPath(key)}
              url={photos[key]}
              onUploaded={(url) => setPhoto(key, url)}
              onDeleted={() => setPhoto(key, null)}
              compact
            />
          ))}
        </div>

        {/* ══ 4. 生活記録 ═══════════════════════════════════ */}
        <SectionHeader emoji="📋" label="生活の記録" />
        <NumberRow emoji="💧" label="水分量" value={form.water_ml}
          onChange={(v) => set('water_ml', v)} unit="mL"
          min="0" max="5000" step="100" placeholder="1500" />
        <NumberRow emoji="😴" label="睡眠" value={form.sleep_hours}
          onChange={(v) => set('sleep_hours', v)} unit="時間"
          min="0" max="24" step="0.5" placeholder="7" />
        <NumberRow emoji="🚽" label="トイレ" value={form.toilet_count}
          onChange={(v) => set('toilet_count', v)} unit="回"
          min="0" max="30" placeholder="6" />

        <div className="mt-5 space-y-3">
          <BigToggle label="💩 排便" value={form.bowel_movement}
            onChange={(v) => set('bowel_movement', v)}
            trueLabel="あり" falseLabel="なし" falseColor="bg-gray-400" />
          <BigToggle label="🔴 生理" value={form.menstruation}
            onChange={(v) => set('menstruation', v)}
            trueLabel="あり" falseLabel="なし" falseColor="bg-gray-400" />
        </div>

        {/* ══ 5. コメント ═══════════════════════════════════ */}
        <SectionHeader emoji="💬" label="今日のコメント（任意）" />
        <textarea
          value={form.comment}
          onChange={(e) => set('comment', e.target.value)}
          rows={4}
          placeholder="今日の体調や気づいたことを書いてください"
          className="w-full text-xl bg-gray-50 rounded-2xl border-2 border-gray-200 focus:border-blue-400 outline-none p-4 text-gray-800 resize-none"
        />

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-lg text-red-700">
            {error}
          </div>
        )}

        {/* 送信ボタン */}
        <button
          type="submit"
          disabled={saving}
          className="mt-8 w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white text-2xl font-black py-7 rounded-2xl shadow-lg transition-colors"
        >
          {saving ? '保存中…' : '記録を送信する'}
        </button>

        <div className="h-8" />
      </form>
    </div>
  )
}
