import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { isValidWeight, filterWeightInput, WEIGHT_ERROR_MSG } from '../../lib/weightValidator'

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-blue-400 transition'

// ── true / false / null の3値ボタン ─────────────────────────
function TriState({ value, onChange, labels }) {
  const opts = [
    { v: true,  label: labels?.[0] ?? 'あり' },
    { v: false, label: labels?.[1] ?? 'なし' },
    { v: null,  label: '未入力' },
  ]
  return (
    <div className="flex gap-1.5">
      {opts.map(({ v, label }) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors font-medium
            ${value === v
              ? v === true  ? 'bg-blue-600 text-white border-blue-600'
              : v === false ? 'bg-gray-500 text-white border-gray-500'
              : 'bg-gray-200 text-gray-600 border-gray-300'
              : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ── 食べた / 食べてない / 外食 / 未入力 の4値ボタン ───────────
// ate_X（食べたか）と ate_out_X（外食か）の2フィールドを1つのUIで操作する
function MealQuad({ eaten, ateOut, onChange }) {
  const selected = eaten === true && ateOut ? 'out'
    : eaten === true ? 'eaten'
    : eaten === false ? 'not'
    : 'unset'

  const opts = [
    { key: 'eaten', label: '食べた',   eaten: true,  ateOut: false, active: 'bg-blue-600 text-white border-blue-600' },
    { key: 'not',   label: '食べてない', eaten: false, ateOut: false, active: 'bg-gray-500 text-white border-gray-500' },
    { key: 'out',   label: '外食',     eaten: true,  ateOut: true,  active: 'bg-orange-500 text-white border-orange-500' },
    { key: 'unset', label: '未入力',   eaten: null,  ateOut: false, active: 'bg-gray-200 text-gray-600 border-gray-300' },
  ]

  return (
    <div className="flex flex-wrap gap-1.5">
      {opts.map(({ key, label, eaten: e, ateOut: o, active }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(e, o)}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors font-medium
            ${selected === key ? active : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

// ── 初期フォーム値を既存ログから生成 ─────────────────────────
function buildInitial(date, log) {
  if (!log) {
    // 新規追加時のみ：スタッフが入力しやすいよう、よく使う値をデフォルト選択
    return {
      date, morning_kg: '', evening_kg: '',
      water_ml: '', toilet_count: '', sleep_hours: '',
      bowel_movement: true, menstruation: false,
      ate_breakfast: true, ate_lunch: true, ate_dinner: true, ate_snack: false,
      ate_out_breakfast: false, ate_out_lunch: false, ate_out_dinner: false,
      comment: '',
    }
  }
  return {
    date:              log.date             ?? date,
    morning_kg:        log.morning_kg       != null ? String(log.morning_kg)    : '',
    evening_kg:        log.evening_kg       != null ? String(log.evening_kg)    : '',
    water_ml:          log.water_ml         != null ? String(log.water_ml)      : '',
    toilet_count:      log.toilet_count     != null ? String(log.toilet_count)  : '',
    sleep_hours:       log.sleep_hours      != null ? String(log.sleep_hours)   : '',
    bowel_movement:    log.bowel_movement   ?? null,
    menstruation:      log.menstruation     ?? null,
    ate_breakfast:     log.ate_breakfast    ?? null,
    ate_lunch:         log.ate_lunch        ?? null,
    ate_dinner:        log.ate_dinner       ?? null,
    ate_snack:         log.ate_snack        ?? null,
    ate_out_breakfast: log.ate_out_breakfast ?? false,
    ate_out_lunch:     log.ate_out_lunch     ?? false,
    ate_out_dinner:    log.ate_out_dinner    ?? false,
    comment:           log.comment          ?? '',
  }
}

/**
 * 管理者記録編集モーダル
 * Props:
 *   clientId    - clients.id
 *   date        - 初期日付（yyyy-MM-dd）
 *   existingLog - weight_logs の既存レコード（null なら新規）
 *   onClose     - 閉じる
 *   onSaved     - 保存完了後に呼ぶ（refreshKey++ + toast）
 */
export default function AdminRecordEditModal({ clientId, date, existingLog, onClose, onSaved }) {
  const [form, setForm] = useState(() => buildInitial(date, existingLog))
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))
  const inp = (key) => (e) => set(key, e.target.value)

  // モーダル内で日付を変更した時：その日付の既存記録を取得して反映（なければ新規＝管理者用デフォルト）
  async function handleDateChange(e) {
    const newDate = e.target.value
    set('date', newDate)
    if (!newDate) return
    const { data } = await supabase
      .from('weight_logs')
      .select('*')
      .eq('client_id', clientId)
      .eq('date', newDate)
      .maybeSingle()
    setForm(buildInitial(newDate, data ?? null))
  }

  // 体重専用の onChange（小数点1桁制限）
  const weightInp = (key) => (e) => {
    const filtered = filterWeightInput(e.target.value)
    if (filtered !== null) set(key, filtered)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.date) { setError('日付を入力してください'); return }
    // 体重バリデーション（二重チェック）
    if (!isValidWeight(form.morning_kg)) { setError(`朝体重：${WEIGHT_ERROR_MSG}`); return }
    if (!isValidWeight(form.evening_kg)) { setError(`夜体重：${WEIGHT_ERROR_MSG}`); return }
    setSaving(true)
    setError(null)

    const payload = {
      client_id:         clientId,
      date:              form.date,
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
      input_by:          'admin',
    }

    // upsert: 同日付が既にあれば更新、なければ新規作成
    const { error: saveErr } = await supabase
      .from('weight_logs')
      .upsert(payload, { onConflict: 'client_id,date' })

    setSaving(false)
    if (saveErr) {
      setError(`保存に失敗しました：${saveErr.message}`)
    } else {
      onSaved()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-800">
              {existingLog ? '記録を編集' : '記録を新規追加'}
            </h2>
            <p className="text-xs text-blue-600 font-medium mt-0.5">
              🔑 管理者として入力（admin）
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* フォーム */}
        <form onSubmit={handleSave} className="px-6 py-5 space-y-5 max-h-[75vh] overflow-y-auto">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* 日付 */}
          <Field label="日付 *">
            <input type="date" className={inputCls} value={form.date}
              onChange={handleDateChange} required />
          </Field>

          {/* ── 体重 ── */}
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">体重</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="朝体重 (kg)">
                <input type="number" inputMode="decimal" step="0.1" min="20" max="300"
                  className={`${inputCls} ${form.morning_kg && !isValidWeight(form.morning_kg) ? 'border-red-300 focus:border-red-400' : ''}`}
                  value={form.morning_kg} onChange={weightInp('morning_kg')} placeholder="--.-" />
                {form.morning_kg && !isValidWeight(form.morning_kg) && (
                  <p className="text-xs text-red-500 mt-1">小数点以下1桁まで（例：65.5）</p>
                )}
              </Field>
              <Field label="夜体重 (kg)">
                <input type="number" inputMode="decimal" step="0.1" min="20" max="300"
                  className={`${inputCls} ${form.evening_kg && !isValidWeight(form.evening_kg) ? 'border-red-300 focus:border-red-400' : ''}`}
                  value={form.evening_kg} onChange={weightInp('evening_kg')} placeholder="--.-" />
                {form.evening_kg && !isValidWeight(form.evening_kg) && (
                  <p className="text-xs text-red-500 mt-1">小数点以下1桁まで（例：65.5）</p>
                )}
              </Field>
            </div>
          </div>

          {/* ── 生活記録 ── */}
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">生活記録</p>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <Field label="水分量 (ml)">
                <input type="number" step="100" min="0" max="5000" className={inputCls}
                  value={form.water_ml} onChange={inp('water_ml')} placeholder="1500" />
              </Field>
              <Field label="トイレ回数 (回)">
                <input type="number" step="1" min="0" max="30" className={inputCls}
                  value={form.toilet_count} onChange={inp('toilet_count')} placeholder="6" />
              </Field>
              <Field label="睡眠時間 (時間)">
                <input type="number" step="0.5" min="0" max="24" className={inputCls}
                  value={form.sleep_hours} onChange={inp('sleep_hours')} placeholder="7.0" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="排便">
                <TriState value={form.bowel_movement} onChange={v => set('bowel_movement', v)}
                  labels={['あり', 'なし']} />
              </Field>
              <Field label="生理">
                <TriState value={form.menstruation} onChange={v => set('menstruation', v)}
                  labels={['あり', 'なし']} />
              </Field>
            </div>
          </div>

          {/* ── 食事記録 ── */}
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">食事記録</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="朝食">
                <MealQuad eaten={form.ate_breakfast} ateOut={form.ate_out_breakfast}
                  onChange={(e, o) => setForm(f => ({ ...f, ate_breakfast: e, ate_out_breakfast: o }))} />
              </Field>
              <Field label="昼食">
                <MealQuad eaten={form.ate_lunch} ateOut={form.ate_out_lunch}
                  onChange={(e, o) => setForm(f => ({ ...f, ate_lunch: e, ate_out_lunch: o }))} />
              </Field>
              <Field label="夕食">
                <MealQuad eaten={form.ate_dinner} ateOut={form.ate_out_dinner}
                  onChange={(e, o) => setForm(f => ({ ...f, ate_dinner: e, ate_out_dinner: o }))} />
              </Field>
              <Field label="間食">
                <TriState value={form.ate_snack} onChange={v => set('ate_snack', v)}
                  labels={['あり', 'なし']} />
              </Field>
            </div>
          </div>

          {/* ── メモ ── */}
          <Field label="メモ・コメント">
            <textarea className={`${inputCls} resize-none`} rows={3}
              value={form.comment} onChange={inp('comment')}
              placeholder="体調、食事内容など自由記入" />
          </Field>
        </form>

        {/* フッター */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? '保存中…' : '保存する'}
          </button>
        </div>
      </div>
    </div>
  )
}
