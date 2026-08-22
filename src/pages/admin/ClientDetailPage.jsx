import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import BackButton from '../../components/BackButton'
import { SELECTED_STORE_STORAGE_KEY, STORE_QUERY_PARAM } from '../../lib/clientListNav'
import { readNameHidden, writeNameHidden } from '../../lib/nameVisibility'
import { fetchAllPages } from '../../lib/fetchAllPages'
import { computeWeightSummary } from '../../lib/weightSummary'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { format, parseISO, subDays } from 'date-fns'
import { ja } from 'date-fns/locale'
import { supabase }     from '../../lib/supabase'
import ClientForm       from '../../components/admin/ClientForm'
import BodyPhotoSection from '../../components/admin/BodyPhotoSection'
import MonthlyTable     from '../../components/admin/MonthlyTable'
import CommentSection, { useClientCommentCount } from '../../components/admin/CommentSection'
import EvaluationCard   from '../../components/EvaluationCard'
import { useAuth }               from '../../contexts/AuthContext'
import AdminRecordEditModal      from '../../components/admin/AdminRecordEditModal'
import DailyMealPhotos           from '../../components/admin/DailyMealPhotos'
import { birthdateToPassword }   from '../../lib/patientAuth'
import {
  fetchOtherStoreClient, fetchOtherStoreWeightLogs, fetchOtherStoreMealLogs,
} from '../../lib/otherStoreApi'

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
  const location = useLocation()

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
  // admin_commentsの件数取得を許可してよい顧客ID。super_admin直接取得・自店舗直接取得が
  // 正常に完了した場合だけ現在のidを設定する（他店舗RPC経路・権限確認中・エラー時はnullのまま）。
  const [directCommentClientId, setDirectCommentClientId] = useState(null)
  const mealPhotoRef = useRef(null)

  const clientCommentCount        = useClientCommentCount(id, directCommentClientId === id)
  const { signOut, profile }      = useAuth()
  const isSuperAdmin              = profile?.is_super_admin === true
  const [anonymousMode, setAnonymousMode] = useState(false)
  const [nameHidden, setNameHidden] = useState(readNameHidden) // 氏名非表示モード（一覧と共通のsessionStorageで連動）

  function toggleNameHidden() {
    setNameHidden((prev) => {
      const next = !prev
      writeNameHidden(next)
      return next
    })
  }

  // 他店舗スタッフが閲覧している場合（store_id が未設定なら制限なし）
  const isOtherStore = Boolean(
    profile?.store_id &&
    client?.store_id &&
    profile.store_id !== client.store_id &&
    !isSuperAdmin
  )

  // 表示制限：他店舗スタッフ OR super_admin の匿名モード
  const isRestricted = isOtherStore || (isSuperAdmin && anonymousMode)

  // 個人情報（氏名・フリガナ・生年月日）を隠すべきかどうかの統一判定。
  // 「氏名非表示モード」「他店舗閲覧」「本部の匿名モード」のいずれか1つでも該当すれば非表示。
  // ラベルと値で別々の条件を使うと表示の不整合（値だけ実名が漏れる等）が起きるため、
  // 表示箇所は必ずこの1つの値だけで判定する。
  const shouldHidePersonalInfo = isRestricted || nameHidden

  // 他店舗顧客の識別表示：RPC（admin_get_other_store_client）が返すcustomer_numberを
  // 唯一の正規データ源とする（location.stateには依存しない。一覧クリック・reload・
  // URL直接アクセスのいずれでも同じ値になる）。無い場合は実名・仮名へフォールバックせず「—」。
  const otherStoreCode = client?.customer_number || '—'

  // today's/logs/meal のセット処理（直接取得・RPC取得のどちらからでも共通で使う）
  function applyClientData(clientRow, weightRows, mealRows) {
    setClient(clientRow)
    setLogs(weightRows ?? [])
    const mm = {}
    ;(mealRows ?? []).forEach((m) => { mm[m.date] = m })
    setMealLogMap(mm)
  }

  // super_admin：既存どおり無条件の直接取得（店舗を問わず全件アクセス可能）
  async function fetchDirectUnscoped() {
    const [clientRes, logsRes, mealRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', id).single(),
      fetchAllPages((from, to) =>
        supabase.from('weight_logs').select('*').eq('client_id', id)
          .order('date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
      ),
      supabase.from('meal_logs')
        .select('date, breakfast_photo_url, lunch_photo_url, dinner_photo_url, snack_photo_url')
        .eq('client_id', id),
    ])
    if (clientRes.error) {
      setError(clientRes.error.message)
    } else if (logsRes.error) {
      console.error('[ClientDetailPage] weight_logs fetch error:', logsRes.error)
      setError(`体重記録の取得に失敗しました：${logsRes.error.message}`)
    } else {
      applyClientData(clientRes.data, logsRes.data, mealRes.data)
      setDirectCommentClientId(id)
    }
    setLoading(false)

    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', id)
      .eq('role', 'client')
    setHasPatientAccount((count ?? 0) > 0)
  }

  // 通常admin・自店舗：clients を自店舗のstore_idへ明示的に絞った直接取得。
  // このクエリ自体が他店舗の行を返せないため、RLSの状態に関わらず安全。
  async function fetchDirectOwnScoped() {
    if (!profile?.store_id) {
      setError('お客さんが見つかりません')
      setLoading(false)
      return
    }
    const [clientRes, logsRes, mealRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', id).eq('store_id', profile.store_id).single(),
      fetchAllPages((from, to) =>
        supabase.from('weight_logs').select('*').eq('client_id', id)
          .order('date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
      ),
      supabase.from('meal_logs')
        .select('date, breakfast_photo_url, lunch_photo_url, dinner_photo_url, snack_photo_url')
        .eq('client_id', id),
    ])
    if (clientRes.error) {
      setError('お客さんが見つかりません')
    } else if (logsRes.error) {
      console.error('[ClientDetailPage] weight_logs fetch error:', logsRes.error)
      setError(`体重記録の取得に失敗しました：${logsRes.error.message}`)
    } else {
      applyClientData(clientRes.data, logsRes.data, mealRes.data)
      setDirectCommentClientId(id)
    }
    setLoading(false)

    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', id)
      .eq('role', 'client')
    setHasPatientAccount((count ?? 0) > 0)
  }

  // 通常admin・他店舗：匿名化RPC経由でのみ取得する（clients/weight_logs/meal_logsへの直接アクセスなし）。
  // いずれかのRPCが失敗した場合は「0件」として扱わず、取得失敗として停止する
  // （直接取得へのフォールバックは行わない）。
  async function fetchViaOtherStoreRpc(prefetchedClientRow) {
    const [clientRes, weightRes, mealRes] = await Promise.all([
      prefetchedClientRow ? Promise.resolve({ data: prefetchedClientRow, error: null }) : fetchOtherStoreClient(id),
      fetchOtherStoreWeightLogs(id),
      fetchOtherStoreMealLogs(id),
    ])
    if (clientRes.error || !clientRes.data) {
      if (clientRes.error) console.error('[ClientDetailPage] other-store client RPC error:', clientRes.error)
      setError('お客さんが見つかりません')
      setLoading(false)
      return
    }
    if (weightRes.error) {
      console.error('[ClientDetailPage] other-store weight_logs fetch error:', weightRes.error)
      setError('体重記録の取得に失敗しました')
      setLoading(false)
      return
    }
    if (mealRes.error) {
      console.error('[ClientDetailPage] other-store meal_logs fetch error:', mealRes.error)
      setError('食事写真の取得に失敗しました')
      setLoading(false)
      return
    }
    applyClientData(clientRes.data, weightRes.data, mealRes.data)
    // 他店舗は閲覧専用（患者ログイン情報セクション自体を非表示にするため確認不要）
    setHasPatientAccount(null)
    setLoading(false)
  }

  // 通常admin・location.stateが無い場合（詳細画面のリロード・URL直接アクセスなど）の安全な判定。
  // location.state はセキュリティ境界として信用しないため、必ず自分自身で
  // 「id + 自店舗store_idの両方をクエリ自体に含めた自店舗限定確認 → 他店舗匿名化RPC」の順に判定する。
  // 取得後にJavaScript側だけでstore_idを比較する方法は使わない（RLSが無効でも他店舗行を取得できない構造にする）。
  async function resolveOwnerAndFetch() {
    if (!profile?.store_id) {
      // store_id未設定の通常adminは、自店舗判定ができないため全顧客取得へは進ませない
      setError('お客さんが見つかりません')
      setLoading(false)
      return
    }

    const ownCheck = await supabase
      .from('clients')
      .select('id')
      .eq('id', id)
      .eq('store_id', profile.store_id)
      .maybeSingle()

    if (ownCheck.error) {
      console.error('[ClientDetailPage] own-store existence check error:', ownCheck.error)
      setError('お客さん情報の確認に失敗しました')
      setLoading(false)
      return
    }

    if (ownCheck.data) {
      // 自店舗の顧客であることを確認済み → 既存の自店舗直接取得へ進む
      await fetchDirectOwnScoped()
      return
    }

    // 自店舗の顧客ではない → 他店舗匿名化RPCでのみ判定する（直接取得へは進まない）
    const probe = await fetchOtherStoreClient(id)
    if (probe.error || !probe.data) {
      if (probe.error) console.error('[ClientDetailPage] other-store client RPC error:', probe.error)
      setError('お客さんが見つかりません')
      setLoading(false)
      return
    }
    await fetchViaOtherStoreRpc(probe.data)
  }

  async function fetchData() {
    setError(null)
    // 権限確認前・id変更直後は、admin_comments件数取得を必ず無効化する
    setDirectCommentClientId(null)

    if (isSuperAdmin) {
      await fetchDirectUnscoped()
      return
    }

    // location.state はナビゲーション時の参考情報にすぎず、セキュリティ境界としては信用しない。
    // isOtherStore===true でも実際のアクセス制御はRPC内部（SECURITY DEFINER）が行うため、
    // ここで信用して経路を切り替えても安全性は損なわれない。
    const stateHint = location.state?.isOtherStore
    if (stateHint === true) {
      await fetchViaOtherStoreRpc(null)
      return
    }
    if (stateHint === false) {
      await fetchDirectOwnScoped()
      return
    }

    await resolveOwnerAndFetch()
  }

  useEffect(() => { fetchData() }, [id])

  // id が変わるたびにページ最上部へ（一覧→詳細の遷移でも必ず発火）
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }) }, [id])

  function showToast(type, msg) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }

  // 一覧から遷移してきた場合はブラウザ履歴を1つ戻る（スクロール位置も一覧側で復元される）。
  // 直接URLを開いた場合など直前の一覧が無い場合は、保存されている選択店舗の一覧へ遷移する。
  function handleBack() {
    if (location.state?.fromList) {
      navigate(-1)
      return
    }
    const savedStore = sessionStorage.getItem(SELECTED_STORE_STORAGE_KEY)
    navigate(savedStore ? `/admin/clients?${STORE_QUERY_PARAM}=${savedStore}` : '/admin/clients')
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
      if (data.created) {
        setHasPatientAccount(true)
        showToast('success', 'アカウントを新規作成してパスワードを設定しました')
      }
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
      <Link to="/admin/clients" className="flex items-center gap-1.5 text-blue-500 text-sm hover:underline">← 一覧へ戻る</Link>
    </div>
  )
  if (!client) return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
      <p className="text-gray-500">お客さんが見つかりません</p>
      <Link to="/admin/clients" className="flex items-center gap-1.5 text-blue-500 text-sm hover:underline">← 一覧へ戻る</Link>
    </div>
  )

  // ── 顧客番号（DB の customer_number を使用、未設定時は短縮ID）──
  // ※他店舗閲覧（isOtherStore）ではこの値を一切表示しない（otherStoreCode を使う）
  const clientCode = client?.customer_number || `ID-${id.slice(0, 6).toUpperCase()}`

  // ── 集計値 ─────────────────────────────────────────────────
  const todayStr     = format(new Date(), 'yyyy-MM-dd')
  const yesterdayStr = format(subDays(new Date(), 1), 'yyyy-MM-dd')
  const todayLog     = logs.find((l) => l.date === todayStr) ?? null
  const todayMeal    = mealLogMap[todayStr] ?? null
  const yesterdayLog  = logs.find((l) => l.date === yesterdayStr) ?? null
  const yesterdayMeal = mealLogMap[yesterdayStr] ?? null

  // 開始体重／最新体重／体重差：お客さん一覧（ClientListPage）と全く同じ共有関数で算出。
  // 同じ weight_logs に対して一覧・詳細で異なる結果が出ないようにするため、
  // 個別に計算式を書かず computeWeightSummary を両画面から呼び出す。
  const { startWeight: firstKg, latestWeight: currentKg, difference: weightDiff } = computeWeightSummary(logs)

  // チャート用：期間フィルタ
  const periodDays = PERIODS.find((p) => p.key === chartPeriod)?.days ?? 30
  const cutoff     = subDays(new Date(), periodDays)
  const chartLogs  = logs.filter((l) => parseISO(l.date) >= cutoff)
  const chartData  = chartLogs.map((l) => ({
    date: format(parseISO(l.date), 'M/d', { locale: ja }),
    朝:   l.morning_kg ?? undefined,
    夜:   l.evening_kg ?? undefined,
  }))

  // ログイン状態
  const loginStatus = hasPatientAccount === null ? null : hasPatientAccount ? 'issued' : 'unissued'

  // 満年齢を生年月日から計算（自店舗・super_admin用。他店舗はRPCが返す age をそのまま使う）
  function calcAge(birthdateStr) {
    if (!birthdateStr) return null
    const birth = new Date(birthdateStr)
    const today = new Date()
    let age = today.getFullYear() - birth.getFullYear()
    const m = today.getMonth() - birth.getMonth()
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
    return age
  }
  const displayAge = isOtherStore ? (client.age ?? null) : calcAge(client.birthdate)

  // 編集フォーム初期値
  const editInitial = {
    name:        client.name        ?? '',
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
            <h2 className="text-lg font-bold text-gray-800 mb-2">
              {shouldHidePersonalInfo ? `${clientCode}を削除しますか？` : '本当に削除しますか？'}
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              {shouldHidePersonalInfo ? (
                <><span className="font-medium text-gray-700">{clientCode}</span> の全データが削除されます。取り消せません。</>
              ) : (
                <><span className="font-medium text-gray-700">{client.name}</span> さんの全データが削除されます。取り消せません。</>
              )}
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
          <BackButton onClick={handleBack} label="一覧へ" variant="dark" />
          <div>
            {isOtherStore ? (
              <>
                <p className="text-xs font-medium text-orange-600">
                  他店舗顧客{client?.store_name ? `（${client.store_name}）` : ''}
                </p>
                <h1 className="text-[21px] font-bold text-gray-800">{otherStoreCode}</h1>
              </>
            ) : shouldHidePersonalInfo ? (
              <>
                <p className="text-xs font-medium text-gray-400">
                  {isRestricted ? '匿名モード（本部）' : '氏名非表示モード中'}
                </p>
                <h1 className="text-[21px] font-bold text-gray-800">顧客番号：{clientCode}</h1>
              </>
            ) : (
              <>
                <h1 className="text-[21px] font-bold text-gray-800">
                  {client.name}
                  {clientCode && (
                    <span className="ml-2 text-[15px] font-normal text-gray-400">{clientCode}</span>
                  )}
                </h1>
                {client.kana && <p className="text-[15px] text-gray-400">{client.kana}</p>}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 氏名の表示・非表示切替（一覧画面と共通のsessionStorageで連動）。
              isRestricted（他店舗閲覧・本部の匿名モード）では氏名は常に非表示のため、
              このトグルは効果を持たない。ボタン表示だけが実際の状態と矛盾しないよう、
              その間は表示しない。 */}
          {!isRestricted && (
            <button onClick={toggleNameHidden}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors inline-flex items-center gap-1.5
                ${nameHidden
                  ? 'bg-slate-700 text-white border-slate-700 hover:bg-slate-800'
                  : 'bg-white text-slate-600 border-gray-200 hover:bg-gray-50'}`}>
              {nameHidden ? '👁️ 氏名を表示' : '🙈 氏名を非表示'}
            </button>
          )}
          {/* 自店舗のみ記録追加・編集を許可 */}
          {!isRestricted && (
            <>
              <button
                onClick={() => navigate(`/admin/clients/${id}/ocr-import`)}
                className="px-3 py-1.5 text-sm font-medium bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors inline-flex items-center gap-1.5">
                🖼️ 画像からCSV作成
              </button>
              <button
                onClick={() => navigate(`/admin/clients/${id}/import-csv`)}
                className="px-3 py-1.5 text-sm font-medium bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors inline-flex items-center gap-1.5">
                📋 CSVインポート
              </button>
              <button
                onClick={() => setEditModal({
                  date: selectedPhotoDate,
                  log: logs.find((l) => l.date === selectedPhotoDate) ?? null,
                })}
                className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                ＋ 記録を追加・編集
              </button>
            </>
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

      {nameHidden && !isRestricted && (
        <div className="bg-slate-700 text-white text-xs font-medium text-center py-1.5 px-4">
          🙈 氏名非表示モード中
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">

        {/* ══════════════════════════════════════════════
            1. 基本情報
        ══════════════════════════════════════════════ */}
        <section className="bg-white rounded-xl border border-gray-200 px-6 py-5">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-[17px] font-semibold text-gray-400 uppercase tracking-wide">基本情報</h2>
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
              <p className="text-[15px] text-gray-400">{isOtherStore ? '顧客番号' : shouldHidePersonalInfo ? '顧客番号' : '氏名'}</p>
              {isOtherStore
                ? <p className="text-[19px] font-semibold text-gray-900">{otherStoreCode}</p>
                : shouldHidePersonalInfo
                  ? <p className="text-[19px] font-semibold text-gray-900">{clientCode}</p>
                  : <>
                      <p className="text-[19px] font-semibold text-gray-900">{client.name}</p>
                      {client.kana && <p className="text-[15px] text-gray-400">{client.kana}</p>}
                    </>
              }
            </div>
            {displayAge !== null && (
              <div>
                <p className="text-[15px] text-gray-400">年齢</p>
                <p className="text-[19px] font-medium text-gray-800">{displayAge} 歳</p>
              </div>
            )}
            {client.height_cm != null && (
              <div>
                <p className="text-[15px] text-gray-400">身長</p>
                <p className="text-[19px] font-medium text-gray-800">{client.height_cm} cm</p>
              </div>
            )}
            {client.goal_weight != null && (
              <div>
                <p className="text-[15px] text-gray-400">目標体重</p>
                <p className="text-[19px] font-medium text-gray-800">{client.goal_weight} kg</p>
              </div>
            )}
            {/* 生年月日：氏名非表示モード／他店舗閲覧／本部匿名モードのいずれでも値を「非表示」に統一
                （他店舗閲覧ではRPCが生年月日自体を返さないため、この行はそもそも表示されない） */}
            {client.birthdate && (
              <div>
                <p className="text-[15px] text-gray-400">生年月日</p>
                <p className="text-[19px] font-medium text-gray-800">{shouldHidePersonalInfo ? '非表示' : client.birthdate}</p>
              </div>
            )}
          </div>
          {/* 開始体重・現在体重（最新）・体重差：お客さん一覧と同じ算出方法（一致する） */}
          {(firstKg != null || currentKg != null) && (
            <div className="grid grid-cols-3 gap-4 mb-4 max-w-md">
              <div>
                <p className="text-[15px] text-gray-400 mb-0.5">開始体重</p>
                <p className="text-[21px] font-bold text-gray-900">{firstKg != null ? `${firstKg}kg` : '未記録'}</p>
              </div>
              <div>
                <p className="text-[15px] text-gray-400 mb-0.5">現在体重（最新）</p>
                <p className="text-[21px] font-bold text-blue-600">{currentKg != null ? `${currentKg}kg` : '未記録'}</p>
              </div>
              <div>
                <p className="text-[15px] text-gray-400 mb-0.5">体重差</p>
                {weightDiff != null ? (
                  <p className={`text-[21px] font-bold ${weightDiff < 0 ? 'text-red-500' : weightDiff > 0 ? 'text-gray-900' : 'text-gray-500'}`}>
                    {weightDiff >= 0 ? '+' : ''}{weightDiff}kg
                  </p>
                ) : (
                  <p className="text-[21px] font-bold text-gray-300">計算不可</p>
                )}
              </div>
            </div>
          )}
          {/* 目的・悩み（他店舗の場合は非表示） */}
          {!isRestricted && client.memo && (
            <div className="border-l-4 border-blue-500 pl-4 py-2 bg-blue-50 rounded-r-xl">
              <p className="text-[15px] font-bold text-blue-600 mb-1.5">目的・悩み</p>
              <p className="text-[19px] font-bold text-gray-900 leading-relaxed">{client.memo}</p>
            </div>
          )}
        </section>

        {/* ══════════════════════════════════════════════
            患者ログイン情報（自店舗のみ）
        ══════════════════════════════════════════════ */}
        {!isRestricted && (
          <section className="bg-white rounded-xl border border-gray-200 px-6 py-5">
            {/* ヘッダー＋状態バッジ */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[17px] font-semibold text-gray-400 uppercase tracking-wide">患者ログイン情報</h2>
              <div>
                {loginStatus === 'unissued' && <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 border border-gray-200">未発行</span>}
                {loginStatus === 'issued'   && <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 border border-blue-200">発行済み</span>}
              </div>
            </div>

            {hasPatientAccount === null ? (
              <p className="text-sm text-gray-400">確認中…</p>
            ) : hasPatientAccount ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[15px] text-gray-400">ログインID</p>
                    <p className="text-[21px] font-black text-gray-800">{client.customer_number ?? '未発行'}</p>
                  </div>
                  <div>
                    <p className="text-[15px] text-gray-400">ログインURL</p>
                    <p className="text-[14px] font-medium text-gray-700 break-all">{LOGIN_URL}</p>
                  </div>
                </div>

                {showInitialPw ? (
                  <div className="bg-purple-50 border border-purple-100 rounded-xl px-4 py-3">
                    <p className="text-xs text-purple-600 font-bold">初期パスワード（誕生日8桁）</p>
                    <p className="text-xl font-black text-gray-800">
                      {shouldHidePersonalInfo
                        ? '非表示（氏名非表示モード中）'
                        : client.birthdate ? birthdateToPassword(client.birthdate) : '生年月日未登録'}
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

                <div className="flex gap-2 flex-wrap">
                  <button onClick={handleResetPassword} disabled={resettingPw || !client.birthdate}
                    className="px-4 py-2 text-sm font-medium border border-orange-200 text-orange-600 rounded-lg hover:bg-orange-50 disabled:opacity-50 transition-colors">
                    {resettingPw ? '初期化中…' : 'パスワードを誕生日で初期化'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-500 mb-3">患者ログインアカウントが未発行です。</p>
                {!client.birthdate ? (
                  <p className="text-sm text-orange-500">生年月日を登録すると発行できます（「編集」から登録）</p>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={handleIssueAccount} disabled={issuingAccount}
                      className="px-4 py-2.5 text-sm font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                      {issuingAccount ? '発行中…' : '患者ログインアカウント発行'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ══════════════════════════════════════════════
            2. 昨日の健康スコア
        ══════════════════════════════════════════════ */}
        <section>
          <p className="text-[17px] text-gray-900 font-medium mb-2 px-1">
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
          {/* ヘッダー：タイトル＋期間ボタン */}
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-[17px] font-semibold text-gray-500">体重グラフ</h2>
            <div className="flex gap-1">
              {PERIODS.map((p) => (
                <button key={p.key} onClick={() => setChartPeriod(p.key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors
                    ${chartPeriod === p.key
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* 凡例（上部中央） */}
          {chartData.length > 0 && (
            <div className="flex justify-center gap-6 mb-2">
              <span className="flex items-center gap-1.5 text-[15px] font-medium" style={{ color: '#f97316' }}>
                <span className="inline-block w-6 h-0.5 rounded-full" style={{ background: '#f97316' }} />
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#f97316' }} />
                朝の体重
              </span>
              <span className="flex items-center gap-1.5 text-[15px] font-medium" style={{ color: '#38bdf8' }}>
                <span className="inline-block w-6 h-0.5 rounded-full" style={{ background: '#38bdf8' }} />
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#38bdf8' }} />
                夜の体重
              </span>
            </div>
          )}

          {chartData.length === 0 ? (
            <p className="text-center py-10 text-gray-400 text-sm">この期間の記録がありません</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                {/* 薄い破線グリッド */}
                <CartesianGrid strokeDasharray="4 4" stroke="#e5e7eb" vertical />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 14, fill: '#6b7280' }}
                  interval={
                    chartData.length > 90 ? Math.ceil(chartData.length / 18) :
                    chartData.length > 30 ? Math.ceil(chartData.length / 12) :
                    'preserveStartEnd'
                  }
                  tickLine={false}
                />
                <YAxis
                  domain={([min, max]) => {
                    const pad = 0.5
                    return [Math.floor((min - pad) * 10) / 10, Math.ceil((max + pad) * 10) / 10]
                  }}
                  tick={{ fontSize: 14, fill: '#6b7280' }}
                  tickFormatter={(v) => `${v}kg`}
                  width={60}
                  tickLine={false}
                  axisLine={false}
                />
                {/* カスタムツールチップ */}
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const asa  = payload.find(p => p.dataKey === '朝')
                    const yoru = payload.find(p => p.dataKey === '夜')
                    return (
                      <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-[17px] min-w-[140px]">
                        <p className="font-semibold text-gray-700 mb-1.5">日付：{label}</p>
                        {asa  && <p style={{ color: '#f97316' }} className="font-medium">朝の体重：{asa.value} kg</p>}
                        {yoru && <p style={{ color: '#38bdf8' }} className="font-medium">夜の体重：{yoru.value} kg</p>}
                      </div>
                    )
                  }}
                />
                {/* 朝：オレンジ */}
                <Line
                  type="linear"
                  dataKey="朝"
                  stroke="#f97316"
                  strokeWidth={2}
                  dot={{ r: 3.5, fill: '#f97316', strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: '#f97316' }}
                  connectNulls
                  legendType="none"
                />
                {/* 夜：水色 */}
                <Line
                  type="linear"
                  dataKey="夜"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={{ r: 3.5, fill: '#38bdf8', strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: '#38bdf8' }}
                  connectNulls
                  legendType="none"
                />
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
          isOtherStore={isOtherStore}
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
              showToast={showToast}
              isOtherStore={isOtherStore}
              prefetchedMealLog={mealLogMap[selectedPhotoDate] ?? null}
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
