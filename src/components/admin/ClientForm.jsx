import { useState } from 'react'

const EMPTY_FORM = {
  name: '', height_cm: '', goal_weight: '', memo: '', is_active: true, birthdate: '',
}

const inputCls =
  'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition'

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

// 満年齢を計算（誕生日未到達の年は1引く）
function calcAge(birthdateStr) {
  if (!birthdateStr) return null
  const birth = new Date(birthdateStr)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

export default function ClientForm({ initial = {}, onSubmit, onCancel, submitting }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial })
  const [err,  setErr]  = useState('')

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const age = calcAge(form.birthdate)

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim())   { setErr('氏名は必須です'); return }
    if (!form.birthdate)     { setErr('生年月日は必須です'); return }

    // 未来日チェック
    const today = new Date().toISOString().slice(0, 10)
    if (form.birthdate > today) { setErr('生年月日に未来の日付は指定できません'); return }

    // 存在しない日付チェック（例: 2月30日）
    const d = new Date(form.birthdate)
    const [y, m, day] = form.birthdate.split('-').map(Number)
    if (d.getFullYear() !== y || d.getMonth() + 1 !== m || d.getDate() !== day) {
      setErr('存在しない日付が入力されています'); return
    }

    setErr('')

    onSubmit({
      name:        form.name.trim(),
      age:         age ?? null,            // 互換性維持のため保存（表示はbirthdateから計算）
      height_cm:   form.height_cm   ? Number(form.height_cm)   : null,
      goal_weight: form.goal_weight ? Number(form.goal_weight) : null,
      memo:        form.memo.trim() || null,
      is_active:   form.is_active,
      birthdate:   form.birthdate,
    })
  }

  const todayStr = new Date().toISOString().slice(0, 10)

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {err && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>
      )}

      {/* ステータス */}
      <Field label="ステータス">
        <div className="flex gap-2">
          {[
            { v: true,  label: 'プログラム中', active: 'bg-blue-600 text-white' },
            { v: false, label: '終了',          active: 'bg-gray-500 text-white' },
          ].map(({ v, label, active }) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => setForm((f) => ({ ...f, is_active: v }))}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors
                ${form.is_active === v
                  ? active
                  : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'}`}
            >
              {v && <span className="text-red-400 mr-1">●</span>}{label}
            </button>
          ))}
        </div>
      </Field>

      {/* 氏名 */}
      <Field label="氏名" required>
        <input className={inputCls} value={form.name} onChange={set('name')} placeholder="山田 花子" />
      </Field>

      {/* 生年月日・年齢（自動計算） */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="生年月日" required>
          <input
            className={inputCls}
            type="date"
            value={form.birthdate}
            onChange={set('birthdate')}
            max={todayStr}
          />
          <p className="text-xs text-gray-400 mt-1">患者ログインの初期パスワードに使用します（例：19800606）</p>
        </Field>
        <Field label="年齢">
          <div className={`${inputCls} bg-gray-50 text-gray-600 cursor-default select-none`}>
            {age !== null ? `${age}歳` : ''}
          </div>
          <p className="text-xs text-gray-400 mt-1">生年月日から自動計算</p>
        </Field>
      </div>

      {/* 身長・目標体重 */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="身長 (cm)">
          <input className={inputCls} type="number" step="0.1" min="0"
            value={form.height_cm} onChange={set('height_cm')} placeholder="160.0" />
        </Field>
        <Field label="目標体重 (kg)">
          <input className={inputCls} type="number" step="0.1" min="0"
            value={form.goal_weight} onChange={set('goal_weight')} placeholder="55.0" />
        </Field>
      </div>

      {/* 目的・悩み */}
      <Field label="目的・悩み">
        <textarea
          className={`${inputCls} resize-none text-base`}
          value={form.memo} onChange={set('memo')}
          rows={4}
          placeholder="腰痛改善、産後ダイエット、便秘改善など"
        />
      </Field>

      <div className="flex justify-end gap-3 pt-1">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          キャンセル
        </button>
        <button type="submit" disabled={submitting}
          className="px-6 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {submitting ? '保存中…' : '保存する'}
        </button>
      </div>
    </form>
  )
}
