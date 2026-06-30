import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const HOME_SCREEN_DISMISS_KEY = 'addToHomeScreenDismissed'

export default function FirstLoginTips({ clientId, profile }) {
  const [showPasswordTip, setShowPasswordTip] = useState(false)
  const [showHomeTip, setShowHomeTip]         = useState(false)
  const [isIOS, setIsIOS]                     = useState(false)

  useEffect(() => {
    // パスワード変更案内：初回ログイン（first_login_at が null）かつ未変更
    if (profile && !profile.password_changed) {
      setShowPasswordTip(true)
      // 初回ログイン日時を記録（次回以降は first_login_at が埋まっている）
      if (!profile.first_login_at) {
        supabase.from('profiles').update({ first_login_at: new Date().toISOString() }).eq('id', profile.id)
      }
    }
    // ホーム画面追加案内：デバイスごとに1回だけ
    if (!localStorage.getItem(HOME_SCREEN_DISMISS_KEY)) {
      setShowHomeTip(true)
      setIsIOS(/iphone|ipad|ipod/i.test(navigator.userAgent))
    }
  }, [profile])

  function dismissHomeTip() {
    localStorage.setItem(HOME_SCREEN_DISMISS_KEY, '1')
    setShowHomeTip(false)
  }

  if (!showPasswordTip && !showHomeTip) return null

  return (
    <div className="space-y-3 mb-4">
      {showPasswordTip && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl px-4 py-3 flex items-start gap-3">
          <span className="text-xl flex-shrink-0">🔒</span>
          <div className="flex-1">
            <p className="text-sm text-yellow-800 font-medium">
              セキュリティ向上のため、パスワード変更をおすすめします
            </p>
            <Link to={`/client/${clientId}/password`}
              className="text-xs text-yellow-700 underline mt-1 inline-block">
              パスワードを変更する
            </Link>
          </div>
          <button onClick={() => setShowPasswordTip(false)} className="text-yellow-400 text-sm">✕</button>
        </div>
      )}

      {showHomeTip && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 flex items-start gap-3">
          <span className="text-xl flex-shrink-0">📱</span>
          <div className="flex-1">
            <p className="text-sm text-blue-800 font-medium">
              このページをホーム画面に追加すると、次回からアプリのように使えます
            </p>
            <p className="text-xs text-blue-600 mt-1">
              {isIOS
                ? 'Safari下部の共有ボタン → 「ホーム画面に追加」'
                : 'ブラウザメニュー → 「ホーム画面に追加」'}
            </p>
          </div>
          <button onClick={dismissHomeTip} className="text-blue-400 text-sm">✕</button>
        </div>
      )}
    </div>
  )
}
