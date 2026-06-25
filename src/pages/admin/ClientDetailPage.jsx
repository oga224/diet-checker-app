import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { format, parseISO, subDays } from 'date-fns'
import { ja } from 'date-fns/locale'
import { supabase }     from '../../lib/supabase'
import ClientForm       from '../../components/admin/ClientForm'
import BodyPhotoSection from '../../components/admin/BodyPhotoSection'
import MealPhotoSection from '../../components/admin/MealPhotoSection'
import MonthlyTable     from '../../components/admin/MonthlyTable'
import CommentSection, { useClientCommentCount } from '../../components/admin/CommentSection'
import EvaluationCard   from '../../components/EvaluationCard'
import { useAuth }        from '../../contexts/AuthContext'
import { supabaseAdmin }  from '../../lib/supabaseAdmin'

const PERIODS = [
  { key: '1w',  label: '1週間',  days: 7   },
  { key: '2w',  label: '2週間',  days: 14  },
  { key: '1m',  label: '1ヶ月',  days: 30  },
  { key: '3m',  label: '3ヶ月',  days: 90  },
  { key: '12m', label: '12ヶ月', days: 365 },
]

export default function ClientDetailPage() {
  const { id }   = useParams()
  const navigate = useNavigate()

  const [client,     setClient]     = useState(null)
  const [logs,       setLogs]       = useState([])
  const [mealLogMap, setMealLogMap] = useState({})
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [showEdit,   setShowEdit]   = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [toast,      setToast]      = useState(null)
  const [chartPeriod, setChartPeriod] = useState('1m')

  const clientCommentCount = useClientCommentCount(id)
  const { signOut }        = useAuth()

  async function fetchData() {
    const [clientRes, logsRes, mealRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', id).single(),
      supabase.from('weight_logs').select('*').eq('client_id', id).order('date'),
      supabase.from('meal_logs')
        .select('date, breakfast_photo_url, lunch_photo_url, dinner_photo_url, snack_photo_url')
        .eq('client_id', id),
    ])
    if (clientRes.error) {
      setError(clientRes.error.message)
    } else {
      setClient(clientRes.data)
      setLogs(logsRes.data ?? [])
      const mm = {}
      ;(mealRes.data ?? []).forEach((m) => { mm[m.date] = m })
      setMealLogMap(mm)
    }
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [id])

  function showToast(type, msg) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }

  async function handleUpdate(payload) {
    setSubmitting(true)
    const { error } = await supabase.from('clients').update(payload).eq('id', id)
    setSubmitting(false)
    if (error) { showToast('error', `更新に失敗しました：${error.message}`) }
    else { setShowEdit(false); showToast('success', '情報を更新しました'); fetchData() }
  }

  async function handleDelete() {
    setSubmitting(true)

    // 紐づいている Auth User を取得して削除
    if (supabaseAdmin) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('client_id', id)
        .maybeSingle()
      if (profile?.id) {
        await supabaseAdmin.auth.admin.deleteUser(profile.id)
      }
    }

    const { error } = await supabase.from('clients').delete().eq('id', id)
    setSubmitting(false)
    if (error) { showToast('error', `削除に失敗しました：${error.message}`); setShowDelete(false) }
    else { navigate('/admin/clients', { state: { deleted: client?.name } }) }
  }

  // ── ローディング・エラー画面 ───────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )
  if (error) return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
      <p className="text-red-500 text-sm">{error}</p>
      <Link to="/admin/clients" className="text-blue-500 text-sm hover:underline">← 一覧へ</Link>
    </div>
  )
  if (!client) return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
      <p className="text-gray-500">お客さんが見つかりません</p>
      <Link to="/admin/clients" className="text-blue-500 text-sm hover:underline">← 一覧へ</Link>
    </div>
  )

  // ── 集計値 ─────────────────────────────────────────────────
  const todayStr   = format(new Date(), 'yyyy-MM-dd')
  const todayLog   = logs.find((l) => l.date === todayStr) ?? null
  const todayMeal  = mealLogMap[todayStr] ?? null
  const latestLog  = logs.at(-1) ?? null
  const currentKg  = latestLog?.morning_kg ?? null

  // チャート用：期間フィルタ
  const periodDays = PERIODS.find((p) => p.key === chartPeriod)?.days ?? 30
  const cutoff     = subDays(new Date(), periodDays)
  const chartLogs  = logs.filter((l) => parseISO(l.date) >= cutoff)
  const chartData  = chartLogs.map((l) => ({
    date: format(parseISO(l.date), 'M/d', { locale: ja }),
    朝:   l.morning_kg ?? undefined,
    夜:   l.evening_kg ?? undefined,
  }))

  // 編集フォーム初期値
  const editInitial = {
    name:          client.name         ?? '',
    kana:          client.kana         ?? '',
    phone:         client.phone        ?? '',
    goal_weight:   client.goal_weight  != null ? String(client.goal_weight)  : '',
    memo:          client.memo         ?? '',
    age:           client.age          != null ? String(client.age)          : '',
    height_cm:     client.height_cm    != null ? String(client.height_cm)    : '',
    address:       client.address      ?? '',
    contract_type: client.contract_type ?? '',
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── トースト ── */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium
          ${toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}

      {/* ── 編集モーダル ── */}
      {showEdit && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-5">お客さん情報を編集</h2>
            <ClientForm initial={editInitial} onSubmit={handleUpdate}
              onCancel={() => setShowEdit(false)} submitting={submitting} />
          </div>
        </div>
      )}

      {/* ── 削除確認モーダル ── */}
      {showDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-2">本当に削除しますか？</h2>
            <p className="text-sm text-gray-500 mb-6">
              <span className="font-medium text-gray-700">{client.name}</span> さんの全データが削除されます。取り消せません。
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowDelete(false)}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
                キャンセル
              </button>
              <button onClick={handleDelete} disabled={submitting}
                className="px-5 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
                {submitting ? '削除中…' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ヘッダー ── */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Link to="/admin/clients" className="text-sm text-gray-400 hover:text-gray-600">←</Link>
          <div>
            <h1 className="text-lg font-bold text-gray-800">{client.name}</h1>
            {client.kana && <p className="text-xs text-gray-400">{client.kana}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowEdit(true)}
            className="px-3 py-1.5 text-sm font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
            編集
          </button>
          <button onClick={() => setShowDelete(true)}
            className="px-3 py-1.5 text-sm font-medium border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition-colors">
            削除
          </button>
          <button onClick={signOut}
            className="px-3 py-1.5 text-sm font-medium border border-gray-200 text-gray-400 rounded-lg hover:text-red-500 hover:border-red-200 transition-colors">
            ログアウト
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">

        {/* ══════════════════════════════════════════════
            1. 基本情報
        ══════════════════════════════════════════════ */}
        <section className="bg-white rounded-xl border border-gray-200 px-6 py-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">基本情報</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            {client.contract_type && (
              <div>
                <p className="text-xs text-gray-400">契約タイプ</p>
                <p className="font-medium text-gray-700">{client.contract_type}</p>
              </div>
            )}
            {client.age != null && (
              <div>
                <p className="text-xs text-gray-400">年齢</p>
                <p className="font-medium text-gray-700">{client.age} 歳</p>
              </div>
            )}
            {client.height_cm != null && (
              <div>
                <p className="text-xs text-gray-400">身長</p>
                <p className="font-medium text-gray-700">{client.height_cm} cm</p>
              </div>
            )}
            {currentKg != null && (
              <div>
                <p className="text-xs text-gray-400">現在体重</p>
                <p className="font-bold text-blue-600 text-lg">{currentKg} kg</p>
              </div>
            )}
            {client.goal_weight != null && (
              <div>
                <p className="text-xs text-gray-400">目標体重</p>
                <p className="font-medium text-gray-700">{client.goal_weight} kg</p>
              </div>
            )}
            {client.phone && (
              <div>
                <p className="text-xs text-gray-400">電話番号</p>
                <p className="font-medium text-gray-700">{client.phone}</p>
              </div>
            )}
          </div>
          {client.address && (
            <p className="text-sm text-gray-500 mb-2">📍 {client.address}</p>
          )}
          {client.memo && (
            <p className="text-sm text-gray-500 bg-gray-50 rounded-lg px-4 py-3">{client.memo}</p>
          )}

          {/* 今日の健康スコア */}
          <div className="mt-5 pt-5 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              今日の健康スコア（{todayStr}）
            </p>
            {todayLog ? (
              <EvaluationCard log={todayLog} mealLog={todayMeal} admin />
            ) : (
              <div className="rounded-xl bg-gray-50 border border-gray-200 px-5 py-4 text-sm text-gray-400 text-center">
                本日の記録はまだありません
              </div>
            )}
          </div>
        </section>

        {/* ══════════════════════════════════════════════
            2. 体重グラフ
        ══════════════════════════════════════════════ */}
        <section className="bg-white rounded-xl border border-gray-200 px-6 py-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">体重グラフ</h2>
            {/* 期間切り替え */}
            <div className="flex gap-1">
              {PERIODS.map((p) => (
                <button key={p.key} onClick={() => setChartPeriod(p.key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors
                    ${chartPeriod === p.key
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {chartData.length === 0 ? (
            <p className="text-center py-10 text-gray-400 text-sm">この期間の記録がありません</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }}
                  interval={chartData.length > 60 ? Math.floor(chartData.length / 20) : 'preserveStartEnd'} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 12 }}
                  tickFormatter={(v) => `${v}kg`} width={55} />
                <Tooltip formatter={(v) => `${v} kg`} />
                <Legend />
                <Line type="monotone" dataKey="朝" stroke="#3b82f6" strokeWidth={2} dot={chartData.length < 60} connectNulls />
                <Line type="monotone" dataKey="夜" stroke="#f97316" strokeWidth={2} dot={chartData.length < 60} connectNulls strokeDasharray="5 4" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* ══════════════════════════════════════════════
            3. 月間記録表
        ══════════════════════════════════════════════ */}
        <MonthlyTable clientId={id} />

        {/* ══════════════════════════════════════════════
            4. 食事写真
        ══════════════════════════════════════════════ */}
        <MealPhotoSection clientId={id} />

        {/* ══════════════════════════════════════════════
            5. 体型写真
        ══════════════════════════════════════════════ */}
        <BodyPhotoSection clientId={id} showToast={showToast} />

        {/* ══════════════════════════════════════════════
            6. コメント
        ══════════════════════════════════════════════ */}
        <section className="bg-white rounded-xl border border-gray-200 px-6 py-5">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">コメント</h2>
            {clientCommentCount > 0 && (
              <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
                お客さんから {clientCommentCount}件
              </span>
            )}
          </div>
          <CommentSection clientId={id} showToast={showToast} />
        </section>

      </main>
    </div>
  )
}
