import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import FirstLoginTips from '../../components/client/FirstLoginTips'

export default function ClientTopPage() {
  const { id } = useParams()
  const { signOut, profile } = useAuth()
  const [client, setClient]         = useState(null)
  const [todayLog, setTodayLog]     = useState(null)
  const [latestComment, setLatestComment] = useState(null)
  const [loading, setLoading]       = useState(true)

  const today = format(new Date(), 'yyyy-MM-dd')
  const todayLabel = format(new Date(), 'M月d日 (E)', { locale: ja })

  useEffect(() => {
    async function fetchData() {
      const [clientRes, logRes, commentRes] = await Promise.all([
        supabase.from('clients').select('name, goal_weight, customer_number').eq('id', id).single(),
        supabase.from('weight_logs').select('morning_kg, evening_kg, comment')
          .eq('client_id', id).eq('date', today).maybeSingle(),
        supabase.from('admin_comments')
          .select('body, sender, created_at')
          .eq('client_id', id)
          .eq('sender', 'admin')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      if (!clientRes.error)  setClient(clientRes.data)
      if (!logRes.error)     setTodayLog(logRes.data)
      if (!commentRes.error) setLatestComment(commentRes.data)
      setLoading(false)
    }
    fetchData()
  }, [id, today])

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
      </div>
    )
  }

  const hasMorning = todayLog?.morning_kg != null
  const hasEvening = todayLog?.evening_kg != null

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white pb-10">
      {/* ヘッダー */}
      <header className="bg-blue-600 text-white px-5 py-6 text-center shadow-md relative">
        <button
          onClick={signOut}
          className="absolute top-4 right-4 text-blue-200 hover:text-white text-sm transition-colors"
        >
          ログアウト
        </button>
        <p className="text-blue-100 text-base mb-1">{todayLabel}</p>
        <h1 className="text-2xl font-bold">
          {client ? `${client.name} さん` : '体重記録'}
        </h1>
        {client?.goal_weight && (
          <p className="text-blue-200 text-sm mt-1">目標：{client.goal_weight} kg</p>
        )}
        {client?.customer_number && (
          <p className="text-blue-200 text-xs mt-1">ログインID：{client.customer_number}</p>
        )}
      </header>

      <main className="max-w-md mx-auto px-5 pt-8 space-y-4">
        <FirstLoginTips clientId={id} profile={profile} />
        {/* 今日の記録状況 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <p className="text-base font-bold text-gray-700 mb-3">今日の記録</p>
          <div className="grid grid-cols-2 gap-3">
            <div className={`rounded-xl p-4 text-center ${hasMorning ? 'bg-blue-50' : 'bg-gray-50'}`}>
              <p className="text-xs text-gray-500 mb-1">朝の体重</p>
              {hasMorning
                ? <p className="text-2xl font-bold text-blue-600">{todayLog.morning_kg} <span className="text-sm font-normal">kg</span></p>
                : <p className="text-base text-gray-300 font-medium">未入力</p>
              }
            </div>
            <div className={`rounded-xl p-4 text-center ${hasEvening ? 'bg-orange-50' : 'bg-gray-50'}`}>
              <p className="text-xs text-gray-500 mb-1">夜の体重</p>
              {hasEvening
                ? <p className="text-2xl font-bold text-orange-500">{todayLog.evening_kg} <span className="text-sm font-normal">kg</span></p>
                : <p className="text-base text-gray-300 font-medium">未入力</p>
              }
            </div>
          </div>
        </div>

        {/* 記録ボタン */}
        <Link
          to={`/client/${id}/record`}
          className="block w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-center text-xl font-bold py-5 rounded-2xl shadow-md transition-colors"
        >
          今日の記録を入力する
        </Link>

        {/* 履歴・グラフ */}
        <Link
          to={`/client/${id}/history`}
          className="block w-full bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-700 text-center text-lg font-bold py-5 rounded-2xl shadow-sm border border-gray-200 transition-colors"
        >
          記録の履歴・グラフを見る
        </Link>

        {/* カレンダー */}
        <Link
          to={`/client/${id}/calendar`}
          className="block w-full bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-700 text-center text-lg font-bold py-5 rounded-2xl shadow-sm border border-gray-200 transition-colors"
        >
          📅 カレンダーから過去の記録を見る
        </Link>

        {/* 先生からのメッセージ */}
        <Link
          to={`/client/${id}/comments`}
          className="block w-full bg-white hover:bg-gray-50 active:bg-gray-100 rounded-2xl shadow-sm border border-blue-100 overflow-hidden transition-colors"
        >
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-base font-bold text-blue-600">💬 先生へのメッセージ</p>
              <span className="text-gray-400 text-lg">›</span>
            </div>
            {latestComment ? (
              <div className="bg-blue-50 rounded-xl px-4 py-3">
                <p className="text-sm text-gray-700 leading-relaxed line-clamp-2">
                  {latestComment.body}
                </p>
                <p className="text-xs text-gray-400 mt-1.5">
                  {format(parseISO(latestComment.created_at), 'M月d日 HH:mm', { locale: ja })}
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-400">先生へメッセージを送ることができます</p>
            )}
          </div>
        </Link>

        {/* パスワード変更 */}
        <Link
          to={`/client/${id}/password`}
          className="block text-center text-sm text-gray-400 hover:text-gray-600 py-3"
        >
          🔒 パスワードを変更する
        </Link>
      </main>
    </div>
  )
}
