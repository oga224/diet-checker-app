import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export default function ClientPasswordChangePage() {
  const { id } = useParams()
  const [current,  setCurrent]  = useState('')
  const [next,     setNext]     = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState(null)
  const [done,     setDone]     = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (next.length < 6) { setError('新しいパスワードは6文字以上にしてください'); return }
    if (next !== confirm) { setError('確認用パスワードが一致しません'); return }

    setSaving(true)

    // 現在のパスワードを確認（再認証）
    const { data: { session } } = await supabase.auth.getSession()
    const email = session?.user?.email
    const { error: reauthErr } = await supabase.auth.signInWithPassword({ email, password: current })
    if (reauthErr) {
      setSaving(false)
      setError('現在のパスワードが正しくありません')
      return
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password: next })
    setSaving(false)
    if (updateErr) {
      setError(`変更に失敗しました：${updateErr.message}`)
      return
    }

    // password_changed フラグを立てる（初回案内を消す）
    await supabase.from('profiles').update({ password_changed: true }).eq('id', session.user.id)

    setDone(true)
    setCurrent(''); setNext(''); setConfirm('')
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <header className="bg-blue-600 text-white px-5 py-5 shadow-md">
        <div className="flex items-center gap-3">
          <Link to={`/client/${id}`} className="text-blue-200 text-2xl p-1">‹</Link>
          <h1 className="text-xl font-bold">パスワード変更</h1>
        </div>
      </header>

      <main className="max-w-md mx-auto px-5 pt-6">
        {done ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center space-y-4">
            <p className="text-5xl">✅</p>
            <p className="text-xl font-bold text-green-600">パスワードを変更しました</p>
            <Link to={`/client/${id}`}
              className="block w-full bg-blue-600 text-white font-bold py-4 rounded-2xl mt-4">
              トップに戻る
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
            <div>
              <label className="block text-base font-bold text-gray-600 mb-2">現在のパスワード</label>
              <input type="password" value={current} onChange={e => setCurrent(e.target.value)} required
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-base font-bold text-gray-600 mb-2">新しいパスワード</label>
              <input type="password" value={next} onChange={e => setNext(e.target.value)} required
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-base font-bold text-gray-600 mb-2">確認用パスワード</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-blue-400" />
            </div>
            {error && (
              <p className="text-base text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>
            )}
            <button type="submit" disabled={saving}
              className="w-full bg-blue-600 text-white text-xl font-bold py-4 rounded-2xl disabled:opacity-50">
              {saving ? '変更中…' : 'パスワードを変更する'}
            </button>
          </form>
        )}
      </main>
    </div>
  )
}
