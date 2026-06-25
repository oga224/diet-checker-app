import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import ClientForm from '../../components/admin/ClientForm'
import { useAuth } from '../../contexts/AuthContext'
import { evaluateLog, scoreColor, scoreLabel } from '../../lib/evaluateLog'

const today = format(new Date(), 'yyyy-MM-dd')

function ScoreBadge({ weightLog, mealLog }) {
  if (!weightLog) {
    return (
      <span className="text-xs text-gray-300 font-medium bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-full">
        未入力
      </span>
    )
  }
  const { score } = evaluateLog(weightLog, null, mealLog)
  const color     = scoreColor(score)
  return (
    <div className="text-right flex-shrink-0">
      <p className="text-xs text-gray-400 mb-0.5">今日のスコア</p>
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${color.bg} ${color.text} ${color.border}`}>
        {score}点 <span className="font-normal opacity-70">{scoreLabel(score)}</span>
      </span>
    </div>
  )
}

export default function ClientListPage() {
  const { signOut } = useAuth()
  const [clients, setClients]         = useState([])
  const [todayLogs, setTodayLogs]     = useState({})   // client_id → weight_log
  const [todayMeals, setTodayMeals]   = useState({})   // client_id → meal_log
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [showForm, setShowForm]       = useState(false)
  const [submitting, setSubmitting]   = useState(false)
  const [toast, setToast]             = useState(null)

  async function fetchAll() {
    const [clientsRes, logsRes, mealsRes] = await Promise.all([
      supabase.from('clients').select('*').order('kana'),
      supabase.from('weight_logs').select('*').eq('date', today),
      supabase.from('meal_logs')
        .select('client_id, breakfast_photo_url, lunch_photo_url, dinner_photo_url, snack_photo_url')
        .eq('date', today),
    ])

    if (clientsRes.error) { setError(clientsRes.error.message) }
    else { setClients(clientsRes.data) }

    if (!logsRes.error && logsRes.data) {
      const map = {}
      logsRes.data.forEach((l) => { map[l.client_id] = l })
      setTodayLogs(map)
    }
    if (!mealsRes.error && mealsRes.data) {
      const map = {}
      mealsRes.data.forEach((m) => { map[m.client_id] = m })
      setTodayMeals(map)
    }
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  function showToast(type, msg) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }

  async function handleCreate(payload) {
    setSubmitting(true)
    const { error, data } = await supabase.from('clients').insert(payload).select().single()
    setSubmitting(false)
    if (error) {
      showToast('error', `登録に失敗しました：${error.message}`)
    } else {
      setShowForm(false)
      showToast('success', `${data.name} さんを登録しました`)
      fetchAll()
    }
  }

  // 未入力のお客さんを上に表示し、スコアの低い順にソート
  const sorted = [...clients].sort((a, b) => {
    const la = todayLogs[a.id]
    const lb = todayLogs[b.id]
    if (!la && !lb) return 0
    if (!la) return -1
    if (!lb) return 1
    const sa = evaluateLog(la, null, todayMeals[a.id]).score
    const sb = evaluateLog(lb, null, todayMeals[b.id]).score
    return sa - sb
  })

  const inputtedCount   = clients.filter((c) => todayLogs[c.id]).length
  const notInputted     = clients.length - inputtedCount

  return (
    <div className="min-h-screen bg-gray-50">
      {/* トースト */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium
          ${toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}

      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">お客さん一覧</h1>
          <p className="text-sm text-gray-500 mt-0.5">整骨院体重管理システム</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            ＋ 新規登録
          </button>
          <Link to="/" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            ← チェッカー
          </Link>
          <button
            onClick={signOut}
            className="text-sm text-gray-400 hover:text-red-500 transition-colors px-3 py-1.5 border border-gray-200 rounded-lg hover:border-red-200"
          >
            ログアウト
          </button>
        </div>
      </header>

      {/* 新規登録モーダル */}
      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-5">お客さん新規登録</h2>
            <ClientForm
              onSubmit={handleCreate}
              onCancel={() => setShowForm(false)}
              submitting={submitting}
            />
          </div>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            <strong>エラー：</strong> {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : clients.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg">お客さんが登録されていません</p>
            <p className="text-sm mt-1">「＋ 新規登録」ボタンから追加してください</p>
          </div>
        ) : (
          <>
            {/* 今日のサマリーバー */}
            <div className="flex items-center gap-4 mb-4 px-1">
              <p className="text-sm text-gray-500">
                今日（{format(new Date(), 'M月d日')}）の入力状況：
                <span className="font-bold text-blue-600 ml-1">{inputtedCount}人</span>
                <span className="text-gray-400"> / {clients.length}人入力済</span>
              </p>
              {notInputted > 0 && (
                <span className="text-xs font-medium text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
                  {notInputted}人が未入力
                </span>
              )}
            </div>

            <div className="grid gap-3">
              {sorted.map((c) => {
                const wLog = todayLogs[c.id]  ?? null
                const mLog = todayMeals[c.id] ?? null
                return (
                  <Link
                    key={c.id}
                    to={`/admin/clients/${c.id}`}
                    className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center justify-between hover:border-blue-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm flex-shrink-0">
                        {c.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800">{c.name}</p>
                        {c.kana && <p className="text-xs text-gray-400">{c.kana}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <ScoreBadge weightLog={wLog} mealLog={mLog} />
                      {c.goal_weight && (
                        <div className="text-right hidden sm:block">
                          <p className="text-xs text-gray-400">目標体重</p>
                          <p className="text-sm font-medium text-gray-700">{c.goal_weight} kg</p>
                        </div>
                      )}
                      <span className="text-gray-300 text-lg">›</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
