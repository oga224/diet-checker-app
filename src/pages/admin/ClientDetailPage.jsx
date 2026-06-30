import { useEffect, useRef, useState } from 'react'
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
import { useAuth }               from '../../contexts/AuthContext'
import AdminRecordEditModal      from '../../components/admin/AdminRecordEditModal'
import DailyMealPhotos           from '../../components/admin/DailyMealPhotos'
import { birthdateToPassword }   from '../../lib/patientAuth'

const LOGIN_URL = typeof window !== 'undefined' ? `${window.location.origin}/login` : ''

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
  const [chartPeriod,      setChartPeriod]      = useState('1m')
  const [refreshKey,       setRefreshKey]       = useState(0)
  const [editModal,        setEditModal]        = useState(null)
  const [selectedPhotoDate, setSelectedPhotoDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [resettingPw, setResettingPw] = useState(false)
  const [pwResetResult, setPwResetResult] = useState(null)
  const [hasPatientAccount, setHasPatientAccount] = useState(null) // null=未確認
  const [issuingAccount, setIssuingAccount] = useState(false)
  const [issuedCredentials, setIssuedCredentials] = useState(null) // {login_id, password}
  const [showInitialPw, setShowInitialPw] = useState(false)
  const mealPhotoRef = useRef(null)

  const clientCommentCount        = useClientCommentCount(id)
  const { signOut, profile }      = useAuth()
  const isSuperAdmin              = profile?.is_super_admin === true
  const [anonymousMode, setAnonymousMode] = useState(false)

  // 他店舗スタッフが閲覧している場合（store_id が未設定なら制限なし）
  const isOtherStore = Boolean(
    profile?.store_id &&
    client?.store_id &&
    profile.store_id !== client.store_id &&
    !isSuperAdmin
  )

  // 表示制限：他店舗スタッフ OR super_admin の匿名モード
  const isRestricted = isOtherStore || (isSuperAdmin && anonymousMode)

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

    // 患者ログインアカウントの有無を確認
    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', id)
      .eq('role', 'client')
    setHasPatientAccount((count ?? 0) > 0)
  }

  useEffect(() => { fetchData() }, [id])

  // id が変わるたびにページ最上部へ（一覧→詳細の遷移でも必ず発火）
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }) }, [id])

  function showToast(type, msg) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }

  async function handleUpdate(payload) {
    if (isRestricted) { showToast('error', '他店舗顧客のため編集できません'); return }
    setSubmitting(true)
    const { error } = await supabase.from('clients').update(payload).eq('id', id)
    setSubmitting(false)
    if (error) { showToast('error', `更新に失敗しました：${error.message}`) }
    else { setShowEdit(false); showToast('success', '情報を更新しました'); fetchData() }
  }

  async function handleDelete() {
    if (isRestricted) { showToast('error', '他店舗顧客のため削除できません'); return }
    setSubmitting(true)
    const { error } = await supabase.from('clients').delete().eq('id', id)
    setSubmitting(false)
    if (error) { showToast('error', `削除に失敗しました：${error.message}`); setShowDelete(false) }
    else { navigate('/admin/clients', { state: { deleted: client?.name } }) }
  }

  async function handleResetPassword() {
    if (isRestricted) { showToast('error', '他店舗顧客のため操作できません'); return }
    if (!client?.birthdate) { showToast('error', '生年月日が未登録のため初期化できません'); return }
    if (!window.confirm('本当にパスワードを生年月日で初期化しますか？')) return
    setResettingPw(true)
    const { data, error } = await supabase.functions.invoke('reset-patient-password', {
      body: { client_id: id },
    })
    setResettingPw(false)
    if (error || data?.error) {
      showToast('error', `初期化失敗：${data?.error || error.message}`)
    } else {
      setPwResetResult(data.password)
    }
  }

  // 既存患者へのログインアカウント発行（生年月日登録済が条件）
  async function handleIssueAccount() {
    if (isRestricted) { showToast('error', '他店舗顧客のため操作できません'); return }
    if (hasPatientAccount) { showToast('info', 'この患者ログインアカウントはすでに発行済みです'); return }
    if (!client?.birthdate) { showToast('error', '生年月日が未登録のため発行できません'); return }
    if (!client?.customer_number) { showToast('error', '顧客番号が未発行です'); return }
    setIssuingAccount(true)
    const { data, error } = await supabase.functions.invoke('create-patient-user', {
      body: {
        client_id: id,
        customer_number: client.customer_number,
        birthdate: client.birthdate,
        store_id: client.store_id,
      },
    })
    setIssuingAccount(false)
    const errMsg = data?.error || error?.message || ''
    if (errMsg && /already registered|already exists|既に登録|重複/i.test(errMsg)) {
      // 既に Auth ユーザーが存在する（発行済み）場合は赤エラーにせず案内表示
      setHasPatientAccount(true)
      showToast('info', 'この患者ログインアカウントはすでに発行済みです')
    } else if (error || data?.error) {
      showToast('error', `発行失敗：${errMsg}`)
    } else if (data?.already_exists) {
      setHasPatientAccount(true)
      showToast('info', 'この患者ログインアカウントはすでに発行済みです')
    } else {
      setIssuedCredentials(data)
      setHasPatientAccount(true)
    }
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

  // ── 顧客番号（DB の customer_number を使用、未設定時は短縮ID）──
  const clientCode = client?.customer_number || `ID-${id.slice(0, 6).toUpperCase()}`

  // ── 集計値 ─────────────────────────────────────────────────
  const todayStr     = format(new Date(), 'yyyy-MM-dd')
  const yesterdayStr = format(subDays(new Date(), 1), 'yyyy-MM-dd')
  const todayLog     = logs.find((l) => l.date === todayStr) ?? null
  const todayMeal    = mealLogMap[todayStr] ?? null
  const yesterdayLog  = logs.find((l) => l.date === yesterdayStr) ?? null
  const yesterdayMeal = mealLogMap[yesterdayStr] ?? null
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

  // 編集フォーム初期値（表示5項目に絞る）
  const editInitial = {
    name:        client.name        ?? '',
    age:         client.age         != null ? String(client.age)        : '',
    height_cm:   client.height_cm   != null ? String(client.height_cm) : '',
    goal_weight: client.goal_weight != null ? String(client.goal_weight): '',
    memo:        client.memo        ?? '',
    is_active:   client.is_active   ?? true,
    birthdate:   client.birthdate   ?? '',
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* パスワード初期化結果モーダル */}
      {pwResetResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <p className="text-3xl mb-2">🔑</p>
            <h2 className="text-lg font-bold text-gray-800 mb-3">パスワードを初期化しました</h2>
            <div className="bg-purple-50 border border-purple-100 rounded-xl px-4 py-4">
              <p className="text-xs text-purple-600 font-bold">新しいパスワード</p>
              <p className="text-2xl font-black text-gray-800">{pwResetResult}</p>
            </div>
            <button onClick={() => setPwResetResult(null)}
              className="w-full mt-5 bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition-colors">
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* 患者ログインアカウント発行結果モーダル */}
      {issuedCredentials && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="text-center mb-4">
              <p className="text-3xl mb-2">✅</p>
              <h2 className="text-lg font-bold text-gray-800">患者ログイン情報</h2>
              <p className="text-xs text-gray-400 mt-1">この情報を患者様へお渡しください</p>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-4 space-y-3">
              <div>
                <p className="text-xs text-blue-600 font-bold">ログインURL</p>
                <p className="text-sm font-medium text-gray-800 break-all">{LOGIN_URL}</p>
              </div>
              <div>
                <p className="text-xs text-blue-600 font-bold">ログインID</p>
                <p className="text-2xl font-black text-gray-800">{issuedCredentials.login_id}</p>
              </div>
              <div>
                <p className="text-xs text-blue-600 font-bold">初期パスワード</p>
                <p className="text-2xl font-black text-gray-800">{issuedCredentials.password}</p>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(
                    `ログインURL\n${LOGIN_URL}\n\nログインID\n${issuedCredentials.login_id}\n\n初期パスワード\n${issuedCredentials.password}`
                  )
                  showToast('success', 'コピーしました')
                }}
                className="flex-1 bg-white border border-blue-300 text-blue-600 font-bold py-3 rounded-xl hover:bg-blue-50 transition-colors">
                コピー
              </button>
              <button onClick={() => setIssuedCredentials(null)}
                className="flex-1 bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition-colors">
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── 記録編集モーダル（isRestricted の場合は開かない） ── */}
      {editModal && !isRestricted && (
        <AdminRecordEditModal
          clientId={id}
          date={editModal.date}
          existingLog={editModal.log}
          onClose={() => setEditModal(null)}
          onSaved={() => {
            setRefreshKey(k => k + 1)
            fetchData()
            showToast('success', '保存しました')
          }}
        />
      )}

      {/* ── トースト ── */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium
          ${toast.type === 'success' ? 'bg-green-600 text-white'
            : toast.type === 'info' ? 'bg-blue-600 text-white'
            : 'bg-red-600 text-white'}`}>
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
            {isRestricted ? (
              <>
                <p className="text-xs text-orange-600 font-medium">
                  {isOtherStore ? '他店舗顧客' : '匿名モード（本部）'}
                </p>
                <h1 className="text-lg font-bold text-gray-800">顧客番号：{clientCode}</h1>
              </>
            ) : (
              <>
                <h1 className="text-lg font-bold text-gray-800">
                  {client.name}
                  {clientCode && (
                    <span className="ml-2 text-xs font-normal text-gray-400">{clientCode}</span>
                  )}
                </h1>
                {client.kana && <p className="text-xs text-gray-400">{client.kana}</p>}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 自店舗のみ記録追加・編集を許可 */}
          {!isRestricted && (
            <button
              onClick={() => setEditModal({
                date: selectedPhotoDate,
                log: logs.find((l) => l.date === selectedPhotoDate) ?? null,
              })}
              className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              ＋ 記録を追加・編集
            </button>
          )}
          {/* super_admin: 匿名/実名切替 */}
          {isSuperAdmin && (
            <button
              onClick={() => setAnonymousMode(v => !v)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors
                ${anonymousMode
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-white text-purple-600 border-purple-300 hover:bg-purple-50'}`}
            >
              {anonymousMode ? '🔒 匿名モード' : '👁️ 実名モード'}
            </button>
          )}
          {!isRestricted && (
            <>
              <button onClick={() => setShowEdit(true)}
                className="px-3 py-1.5 text-sm font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
                編集
              </button>
              <button onClick={handleResetPassword} disabled={resettingPw}
                className="px-3 py-1.5 text-sm font-medium border border-purple-200 text-purple-600 rounded-lg hover:bg-purple-50 transition-colors disabled:opacity-50">
                {resettingPw ? '初期化中…' : 'パスワード初期化'}
              </button>
              <button onClick={() => setShowDelete(true)}
                className="px-3 py-1.5 text-sm font-medium border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition-colors">
                削除
              </button>
            </>
          )}
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
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">基本情報</h2>
            {client.is_active !== false
              ? <span className="text-xs font-bold text-red-500 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full flex items-center gap-1">
                  <span>●</span> プログラム中
                </span>
              : <span className="text-xs font-bold text-gray-400 bg-gray-100 border border-gray-200 px-2.5 py-1 rounded-full">
                  終了
                </span>
            }
          </div>
          {/* 氏名・年齢・身長・目標体重 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div>
              <p className="text-xs text-gray-400">{isRestricted ? '顧客番号' : '氏名'}</p>
              {isOtherStore
                ? <p className="font-bold text-gray-800 text-lg">{clientCode}</p>
                : <>
                    <p className="font-semibold text-gray-900">{client.name}</p>
                    {client.kana && <p className="text-xs text-gray-400">{client.kana}</p>}
                  </>
              }
            </div>
            {client.age != null && (
              <div>
                <p className="text-xs text-gray-400">年齢</p>
                <p className="font-medium text-gray-800">{client.age} 歳</p>
              </div>
            )}
            {client.height_cm != null && (
              <div>
                <p className="text-xs text-gray-400">身長</p>
                <p className="font-medium text-gray-800">{client.height_cm} cm</p>
              </div>
            )}
            {client.goal_weight != null && (
              <div>
                <p className="text-xs text-gray-400">目標体重</p>
                <p className="font-medium text-gray-800">{client.goal_weight} kg</p>
              </div>
            )}
            {/* 生年月日：自店舗 or super_admin実名のみ表示 */}
            {!isRestricted && client.birthdate && (
              <div>
                <p className="text-xs text-gray-400">生年月日</p>
                <p className="font-medium text-gray-800">{client.birthdate}</p>
              </div>
            )}
          </div>
          {/* 現在体重（最新記録から） */}
          {currentKg != null && (
            <div className="mb-3">
              <p className="text-xs text-gray-400 mb-0.5">現在体重（最新）</p>
              <p className="font-bold text-blue-600 text-lg">{currentKg} kg</p>
            </div>
          )}
          {/* 目的・悩み（他店舗の場合は非表示） */}
          {!isRestricted && client.memo && (
            <div className="border-l-4 border-blue-500 pl-4 py-2 bg-blue-50 rounded-r-xl">
              <p className="text-xs font-bold text-blue-600 mb-1.5">目的・悩み</p>
              <p className="text-base font-bold text-gray-900 leading-relaxed">{client.memo}</p>
            </div>
          )}
        </section>

        {/* ══════════════════════════════════════════════
            患者ログイン情報（自店舗のみ）
        ══════════════════════════════════════════════ */}
        {!isRestricted && (
          <section className="bg-white rounded-xl border border-gray-200 px-6 py-5">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">患者ログイン情報</h2>

            {hasPatientAccount === null ? (
              <p className="text-sm text-gray-400">確認中…</p>
            ) : hasPatientAccount ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-400">ログインアカウント</p>
                  <p className="text-sm font-bold text-green-600">発行済み</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">ログインID</p>
                  <p className="text-lg font-black text-gray-800">{client.customer_number ?? '未発行'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">ログインURL</p>
                  <p className="text-sm font-medium text-gray-700 break-all">{LOGIN_URL}</p>
                </div>

                {showInitialPw ? (
                  <div className="bg-purple-50 border border-purple-100 rounded-xl px-4 py-3">
                    <p className="text-xs text-purple-600 font-bold">初期パスワード（誕生日8桁）</p>
                    <p className="text-xl font-black text-gray-800">
                      {client.birthdate ? birthdateToPassword(client.birthdate) : '生年月日未登録'}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      ※患者がパスワードを変更している場合、現在のパスワードとは異なります
                    </p>
                  </div>
                ) : (
                  <button onClick={() => setShowInitialPw(true)}
                    className="px-4 py-2 text-sm font-medium border border-purple-200 text-purple-600 rounded-lg hover:bg-purple-50 transition-colors">
                    ログイン情報表示
                  </button>
                )}

                <button onClick={handleResetPassword} disabled={resettingPw || !client.birthdate}
                  className="block px-4 py-2 text-sm font-medium border border-orange-200 text-orange-600 rounded-lg hover:bg-orange-50 disabled:opacity-50 transition-colors">
                  {resettingPw ? '初期化中…' : 'パスワードを誕生日で初期化'}
                </button>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-500 mb-3">患者ログインアカウントが未発行です。</p>
                {!client.birthdate ? (
                  <p className="text-sm text-orange-500">生年月日を登録すると発行できます（「編集」から登録）</p>
                ) : (
                  <button onClick={handleIssueAccount} disabled={issuingAccount}
                    className="px-4 py-2.5 text-sm font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    {issuingAccount ? '発行中…' : '患者ログインアカウント発行'}
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {/* ══════════════════════════════════════════════
            2. 昨日の健康スコア
        ══════════════════════════════════════════════ */}
        <section>
          <p className="text-xs text-gray-400 font-medium mb-2 px-1">
            昨日の健康スコア（{yesterdayStr}）
          </p>
          {yesterdayLog ? (
            <EvaluationCard log={yesterdayLog} mealLog={yesterdayMeal} admin />
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 text-sm text-gray-400 text-center">
              昨日のデータがありません
            </div>
          )}
        </section>

        {/* ══════════════════════════════════════════════
            3. 体重グラフ
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
        {/* ══════════════════════════════════════════════
            4. 表1 → 5. 食事写真 → 6. 表2
        ══════════════════════════════════════════════ */}
        <MonthlyTable
          clientId={id}
          refreshKey={refreshKey}
          selectedDate={selectedPhotoDate}
          onDateClick={(date) => {
            setSelectedPhotoDate(date)
            setTimeout(() => {
              mealPhotoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }, 80)
          }}
          renderBetween={
            <DailyMealPhotos
              clientId={id}
              date={selectedPhotoDate}
              sectionRef={mealPhotoRef}
            />
          }
        />

        {/* ══════════════════════════════════════════════
            7. コメント（他店舗はレンダリングしない）
        ══════════════════════════════════════════════ */}
        {!isRestricted && (
          <section className="bg-white rounded-xl border border-gray-200 px-6 py-5">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">コメント</h2>
              {clientCommentCount > 0 && (
                <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
                  お客さんから {clientCommentCount}件
                </span>
              )}
            </div>
            <CommentSection clientId={id} showToast={showToast} isRestricted={isRestricted} />
          </section>
        )}

        {/* ══════════════════════════════════════════════
            8. 体型写真（他店舗はレンダリングしない）
        ══════════════════════════════════════════════ */}
        {!isRestricted && <BodyPhotoSection clientId={id} showToast={showToast} />}

      </main>
    </div>
  )
}
