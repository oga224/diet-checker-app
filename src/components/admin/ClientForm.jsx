import { useState } from 'react'

const CONTRACT_TYPES = ['月額', '回数券', '単発', 'その他']

const EMPTY_FORM = {
  name: '', kana: '', phone: '', goal_weight: '',
  memo: '', age: '', height_cm: '', address: '', contract_type: '',
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition'

export default function ClientForm({ initial = {}, onSubmit, onCancel, submitting }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial })
  const [validationError, setValidationError] = useState('')

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) {
      setValidationError('氏名は必須です')
      return
    }
    setValidationError('')

    const payload = {
      name:          form.name.trim(),
      kana:          form.kana.trim()    || null,
      phone:         form.phone.trim()   || null,
      goal_weight:   form.goal_weight    ? Number(form.goal_weight)  : null,
      memo:          form.memo.trim()    || null,
      age:           form.age           ? Number(form.age)           : null,
      height_cm:     form.height_cm     ? Number(form.height_cm)     : null,
      address:       form.address.trim() || null,
      contract_type: form.contract_type  || null,
    }
    onSubmit(payload)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {validationError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {validationError}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="氏名" required>
          <input className={inputCls} value={form.name} onChange={set('name')} placeholder="山田 花子" />
        </Field>
        <Field label="フリガナ">
          <input className={inputCls} value={form.kana} onChange={set('kana')} placeholder="ヤマダ ハナコ" />
        </Field>
        <Field label="電話番号">
          <input className={inputCls} value={form.phone} onChange={set('phone')} placeholder="090-0000-0000" type="tel" />
        </Field>
        <Field label="契約タイプ">
          <select className={inputCls} value={form.contract_type} onChange={set('contract_type')}>
            <option value="">選択してください</option>
            {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="年齢">
          <input className={inputCls} value={form.age} onChange={set('age')} placeholder="35" type="number" min="0" max="120" />
        </Field>
        <Field label="身長 (cm)">
          <input className={inputCls} value={form.height_cm} onChange={set('height_cm')} placeholder="160.0" type="number" step="0.1" min="0" />
        </Field>
        <Field label="目標体重 (kg)">
          <input className={inputCls} value={form.goal_weight} onChange={set('goal_weight')} placeholder="55.0" type="number" step="0.1" min="0" />
        </Field>
      </div>

      <Field label="住所">
        <input className={inputCls} value={form.address} onChange={set('address')} placeholder="東京都渋谷区..." />
      </Field>

      <Field label="目的・悩み">
        <textarea
          className={`${inputCls} resize-none`}
          value={form.memo}
          onChange={set('memo')}
          rows={3}
          placeholder="腰痛改善、産後ダイエットなど"
        />
      </Field>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          キャンセル
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? '保存中…' : '保存する'}
        </button>
      </div>
    </form>
  )
}
