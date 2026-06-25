import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'
import PhotoUpload    from '../../components/PhotoUpload'
import EvaluationCard from '../../components/EvaluationCard'

const EMPTY = {
  morning_kg: '', evening_kg: '',
  water_ml: '', toilet_count: '', sleep_hours: '',
  bowel_movement: null, menstruation: null,
  ate_breakfast: null, ate_lunch: null, ate_dinner: null, ate_snack: null,
  ate_out_breakfast: false, ate_out_lunch: false, ate_out_dinner: false,
  comment: '',
}

const EMPTY_PHOTOS = {
  breakfast: null, lunch: null, dinner: null, snack: null,
}

function WeightInput({ label, field, value, onChange, color }) {
  return (
    <div className={`rounded-2xl p-5 ${color}`}>
      <p className="text-base font-bold text-gray-700 mb-3">{label}</p>
      <div className="flex items-center gap-3">
        <input
          type="number" step="0.1" min="20" max="300"
          value={value}
          onChange={(e) => onChange(field, e.target.value)}
          placeholder="--.-"
          className="w-full text-4xl font-bold text-center bg-white rounded-xl border-2 border-gray-200 focus:border-blue-400 outline-none py-4 text-gray-800"
        />
        <span className="text-xl font-bold text-gray-500 flex-shrink-0">kg</span>
      </div>
    </div>
  )
}

function NumberInput({ label, field, value, onChange, unit, min, max, step = '1', placeholder }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <p className="text-base font-bold text-gray-700 mb-3">{label}</p>
      <div className="flex items-center gap-3">
        <input
          type="number" step={step} min={min} max={max}
          value={value}
          onChange={(e) => onChange(field, e.target.value)}
          placeholder={placeholder}
          className="w-full text-3xl font-bold text-center bg-gray-50 rounded-xl border-2 border-gray-200 focus:border-blue-400 outline-none py-3 text-gray-800"
        />
        <span className="text-lg font-bold text-gray-500 flex-shrink-0">{unit}</span>
      </div>
    </div>
  )
}

function YesNoInput({ label, field, value, onChange, yesLabel = 'あり', noLabel = 'なし' }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <p className="text-base font-bold text-gray-700 mb-3">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        {[{ val: true, label: yesLabel }, { val: false, label: noLabel }].map(({ val, label: l }) => (
          <button
            key={String(val)}
            type="button"
            onClick={() => onChange(field, value === val ? null : val)}
            className={`py-4 rounded-xl text-lg font-bold border-2 transition-all active:scale-95
              ${value === val
                ? val ? 'bg-green-500 text-white border-green-500' : 'bg-gray-400 text-white border-gray-400'
                : 'bg-white text-gray-400 border-gray-200'
              }`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function ClientRecordPage() {
  const { id } = useParams()
  const [form, setForm]           = useState(EMPTY)
  const [photos, setPhotos]       = useState(EMPTY_PHOTOS)
  const [clientName, setClientName] = useState('')
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)
  const [savedLog, setSavedLog]     = useState(null)
  const [savedMealLog, setSavedMealLog] = useState(null)
  const [prevKg, setPrevKg]         = useState(null)
  const [error, setError]         = useState(null)
  const [existingLogId, setExistingLogId]   = useState(null)
  const [existingMealId, setExistingMealId] = useState(null)

  const today      = format(new Date(), 'yyyy-MM-dd')
  const todayLabel = format(new Date(), 'M月d日 (E)', { locale: ja })

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
          morning_kg:     d.morning_kg    != null ? String(d.morning_kg)    : '',
          evening_kg:     d.evening_kg    != null ? String(d.evening_kg)    : '',
          water_ml:       d.water_ml      != null ? String(d.water_ml)      : '',
          toilet_count:   d.toilet_count  != null ? String(d.toilet_count)  : '',
          sleep_hours:    d.sleep_hours   != null ? String(d.sleep_hours)   : '',
          bowel_movement: d.bowel_movement ?? null,
          menstruation:   d.menstruation  ?? null,
          ate_breakfast:  d.ate_breakfast ?? null,
          ate_lunch:      d.ate_lunch     ?? null,
          ate_dinner:     d.ate_dinner    ?? null,
          ate_snack:          d.ate_snack          ?? null,
          ate_out_breakfast:  d.ate_out_breakfast  ?? false,
          ate_out_lunch:      d.ate_out_lunch      ?? false,
          ate_out_dinner:     d.ate_out_dinner     ?? false,
          comment:            d.comment            ?? '',
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

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function setPhoto(key, url) {
    setPhotos((p) => ({ ...p, [key]: url }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const weightPayload = {
      client_id:      id,
      date:           today,
      morning_kg:     form.morning_kg    !== '' ? Number(form.morning_kg)    : null,
      evening_kg:     form.evening_kg    !== '' ? Number(form.evening_kg)    : null,
      water_ml:       form.water_ml      !== '' ? Number(form.water_ml)      : null,
      toilet_count:   form.toilet_count  !== '' ? Number(form.toilet_count)  : null,
      sleep_hours:    form.sleep_hours   !== '' ? Number(form.sleep_hours)   : null,
      bowel_movement: form.bowel_movement,
      menstruation:   form.menstruation,
      ate_breakfast:  form.ate_breakfast,
      ate_lunch:      form.ate_lunch,
      ate_dinner:     form.ate_dinner,
      ate_snack:          form.ate_snack,
      ate_out_breakfast:  form.ate_out_breakfast,
      ate_out_lunch:      form.ate_out_lunch,
      ate_out_dinner:     form.ate_out_dinner,
      comment:            form.comment.trim() || null,
    }

    const mealPayload = {
      client_id:           id,
      date:                today,
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

  if (saved) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white pb-10">
        <div className="max-w-md mx-auto px-5 pt-10 space-y-6">
          {/* 完了メッセージ */}
          <div className="text-center">
            <div className="text-6xl mb-4">✅</div>
            <h2 className="text-3xl font-bold text-green-600 mb-1">送信しました！</h2>
            <p className="text-base text-gray-500">{todayLabel} の記録を保存しました</p>
          </div>

          {/* 自動評価 */}
          {savedLog && (
            <EvaluationCard log={savedLog} prevKg={prevKg} mealLog={savedMealLog} />
          )}

          {/* ナビゲーション */}
          <Link to={`/client/${id}`}
            className="block w-full bg-blue-600 text-white text-xl font-bold py-5 rounded-2xl shadow-md text-center">
            トップに戻る
          </Link>
          <Link to={`/client/${id}/history`}
            className="block w-full bg-white text-gray-600 text-lg font-bold py-5 rounded-2xl shadow-sm border border-gray-200 text-center">
            履歴・グラフを見る
          </Link>
        </div>
      </div>
    )
  }

  // 食事写真のStorage path
  const photoPath = (meal) => `${id}/${today}/${meal}.jpg`

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <header className="bg-blue-600 text-white px-5 py-5 shadow-md">
        <div className="flex items-center gap-3 mb-1">
          <Link to={`/client/${id}`} className="text-blue-200 text-2xl leading-none">‹</Link>
          <p className="text-blue-100 text-base">{todayLabel}</p>
        </div>
        <h1 className="text-2xl font-bold pl-8">
          {clientName ? `${clientName} さんの記録` : '今日の記録'}
        </h1>
      </header>

      <form onSubmit={handleSubmit} className="max-w-md mx-auto px-4 pt-6 space-y-5">

        {/* 体重 */}
        <WeightInput label="🌅 朝の体重" field="morning_kg" value={form.morning_kg} onChange={set} color="bg-blue-50" />
        <WeightInput label="🌙 夜の体重" field="evening_kg" value={form.evening_kg} onChange={set} color="bg-orange-50" />

        {/* 生活記録 */}
        <p className="text-base font-bold text-gray-500 pt-2">生活の記録</p>

        <NumberInput label="💧 今日の水分量" field="water_ml" value={form.water_ml}
          onChange={set} unit="ml" min="0" max="5000" step="100" placeholder="1500" />
        <NumberInput label="🚽 トイレの回数" field="toilet_count" value={form.toilet_count}
          onChange={set} unit="回" min="0" max="30" placeholder="6" />
        <NumberInput label="😴 睡眠時間" field="sleep_hours" value={form.sleep_hours}
          onChange={set} unit="時間" min="0" max="24" step="0.5" placeholder="7.0" />

        <YesNoInput label="💩 排便はありましたか？" field="bowel_movement" value={form.bowel_movement} onChange={set} />
        <YesNoInput label="🔴 生理中ですか？" field="menstruation" value={form.menstruation} onChange={set} />

        {/* 食事記録＋写真 */}
        <p className="text-base font-bold text-gray-500 pt-2">食事の記録</p>

        {/* 朝食 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <YesNoInput label="🍳 朝ごはんを食べましたか？" field="ate_breakfast"
            value={form.ate_breakfast} onChange={set} yesLabel="食べた" noLabel="食べてない" />
          <PhotoUpload
            label="📷 朝食の写真"
            bucket="meal-photos"
            storagePath={photoPath('breakfast')}
            url={photos.breakfast}
            onUploaded={(url) => setPhoto('breakfast', url)}
            onDeleted={() => setPhoto('breakfast', null)}
          />
        </div>

        {/* 昼食 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <YesNoInput label="🍱 昼ごはんを食べましたか？" field="ate_lunch"
            value={form.ate_lunch} onChange={set} yesLabel="食べた" noLabel="食べてない" />
          <PhotoUpload
            label="📷 昼食の写真"
            bucket="meal-photos"
            storagePath={photoPath('lunch')}
            url={photos.lunch}
            onUploaded={(url) => setPhoto('lunch', url)}
            onDeleted={() => setPhoto('lunch', null)}
          />
        </div>

        {/* 夕食 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <YesNoInput label="🍚 夜ごはんを食べましたか？" field="ate_dinner"
            value={form.ate_dinner} onChange={set} yesLabel="食べた" noLabel="食べてない" />
          <PhotoUpload
            label="📷 夕食の写真"
            bucket="meal-photos"
            storagePath={photoPath('dinner')}
            url={photos.dinner}
            onUploaded={(url) => setPhoto('dinner', url)}
            onDeleted={() => setPhoto('dinner', null)}
          />
        </div>

        {/* 間食 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <YesNoInput label="🍰 間食はしましたか？" field="ate_snack"
            value={form.ate_snack} onChange={set} yesLabel="した" noLabel="してない" />
          <PhotoUpload
            label="📷 間食の写真"
            bucket="meal-photos"
            storagePath={photoPath('snack')}
            url={photos.snack}
            onUploaded={(url) => setPhoto('snack', url)}
            onDeleted={() => setPhoto('snack', null)}
          />
        </div>

        {/* 外食記録 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-base font-bold text-gray-700 mb-1">🍽️ 外食の記録</p>
          <p className="text-sm text-gray-400 mb-3">外食した食事を選んでください（複数可）</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { field: 'ate_out_breakfast', label: '朝食 (M)' },
              { field: 'ate_out_lunch',     label: '昼食 (L)' },
              { field: 'ate_out_dinner',    label: '夕食 (D)' },
            ].map(({ field, label }) => (
              <button
                key={field}
                type="button"
                onClick={() => set(field, !form[field])}
                className={`py-4 rounded-xl text-base font-bold border-2 transition-all active:scale-95
                  ${form[field]
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white text-gray-400 border-gray-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* コメント */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-base font-bold text-gray-700 mb-3">💬 今日のコメント</p>
          <textarea
            value={form.comment}
            onChange={(e) => set('comment', e.target.value)}
            rows={4}
            placeholder="今日の体調や気づいたことを書いてください"
            className="w-full text-lg bg-gray-50 rounded-xl border-2 border-gray-200 focus:border-blue-400 outline-none p-4 text-gray-800 resize-none"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-base text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white text-xl font-bold py-6 rounded-2xl shadow-md transition-colors"
        >
          {saving ? '保存中…' : '記録を送信する'}
        </button>

        <div className="h-4" />
      </form>
    </div>
  )
}
