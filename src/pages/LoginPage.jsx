import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { customerNumberToEmail, looksLikeEmail } from '../lib/patientAuth'

export default function LoginPage() {
  const navigate  = useNavigate()
  const [loginId,  setLoginId]  = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [checking, setChecking] = useState(true) // 自動ログイン確認中
  const [error,    setError]    = useState(null)

  async function redirectByProfile(user) {
    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()
    if (profile?.role === 'admin') {
      navigate('/admin/clients', { replace: true })
    } else if (profile?.role === 'client' && profile?.client_id) {
      navigate(`/client/${profile.client_id}`, { replace: true })
    } else {
      setError('アカウントの設定が不完全です。管理者にお問い合わせください。')
      await supabase.auth.signOut()
    }
  }

  // 既にログイン済みのセッションがあれば自動でスキップ
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        await redirectByProfile(session.user)
      }
      setChecking(false)
    })
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // 顧客番号（A-00005等）が入力された場合は内部メールに変換
    const email = looksLikeEmail(loginId) ? loginId : customerNumberToEmail(loginId)

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) {
      setError('ログインIDまたはパスワードが正しくありません')
      setLoading(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    await redirectByProfile(user)
    setLoading(false)
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-blue-50">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-white text-2xl font-black">体</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">体重管理システム</h1>
          <p className="text-sm text-gray-400 mt-1">整骨院向け体重管理アプリ</p>
        </div>

        <form onSubmit={handleLogin} className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-8 space-y-5">
          <h2 className="text-base font-bold text-gray-700 text-center">ログイン</h2>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">
              ログインID（顧客番号 または 管理者メール）
            </label>
            <input
              type="text"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              required
              placeholder="A-00005 または example@email.com"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-800 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">パスワード</label>
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
        <p className="text-center text-xs text-gray-400 mt-2">
          パスワードを忘れた方は<br />店舗スタッフへご相談ください
        </p>
      </div>
    </div>
  )
}
