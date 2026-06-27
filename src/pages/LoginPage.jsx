import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function LoginPage() {
  const navigate  = useNavigate()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) {
      setError('メールアドレスまたはパスワードが正しくありません')
      setLoading(false)
      return
    }

    // ログイン成功 → プロフィールを取得してリダイレクト
    const { data: { user } } = await supabase.auth.getUser()
    const { data: profile }  = await supabase
      .from('profiles').select('*').eq('id', user.id).single()

    if (profile?.role === 'admin') {
      navigate('/admin/clients', { replace: true })
    } else if (profile?.role === 'client' && profile?.client_id) {
      navigate(`/client/${profile.client_id}`, { replace: true })
    } else {
      setError('アカウントの設定が不完全です。管理者にお問い合わせください。')
      await supabase.auth.signOut()
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col items-center justify-center px-5">
      <div className="w-full max-w-sm">
        {/* ロゴ */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-white text-2xl font-black">体</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">体重管理システム</h1>
          <p className="text-sm text-gray-400 mt-1">整骨院向け体重管理アプリ</p>
        </div>

        {/* フォーム */}
        <form onSubmit={handleLogin} className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-8 space-y-5">
          <h2 className="text-base font-bold text-gray-700 text-center">ログイン</h2>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">
              メールアドレス
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="example@email.com"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-800 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">
              パスワード
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="パスワードを入力"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-800 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white font-bold text-base py-3.5 rounded-xl transition-colors shadow-sm"
          >
            {loading ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          アカウントをお持ちでない方は管理者にお問い合わせください
        </p>
      </div>
    </div>
  )
}
