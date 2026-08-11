import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import BackButton from '../../components/BackButton'
import { format, differenceInDays, parseISO } from 'date-fns'
import { supabase }  from '../../lib/supabase'
import ClientForm    from '../../components/admin/ClientForm'
import { useAuth }   from '../../contexts/AuthContext'
import { evaluateLog, scoreColor, scoreLabel, pendingColor } from '../../lib/evaluateLog'
import {
  STORE_QUERY_PARAM, STORE_ALL_VALUE, SELECTED_STORE_STORAGE_KEY,
  RETURN_FLAG_STORAGE_KEY, scrollPosKey,
} from '../../lib/clientListNav'
import { readNameHidden, writeNameHidden } from '../../lib/nameVisibility'
import { fetchAllPages } from '../../lib/fetchAllPages'
import { computeWeightSummary, findLatestLog } from '../../lib/weightSummary'
import { fetchOtherStoreClients, buildOtherStoreWeightInfo } from '../../lib/otherStoreApi'

const todayStr = format(new Date(), 'yyyy-MM-dd')

// ── 入力状況バッジ ────────────────────────────────────────────
// hasToday/hist は呼び出し側（自店舗・他店舗共通のresolveWeightInfo）で
// 解決済みの値を渡す。自店舗・他店舗のどちらでも同じ判定・表示になる。
function EntryBadge({ hasToday, hist }) {
  if (hasToday) {
    return (
      <span className="text-xs font-medium bg-green-50 text-green-600 border border-green-200 px-2 py-0.5 rounded-full whitespace-nowrap">
        今日入力済み
      </span>
    )
  }
  if (!hist?.lastDate) {
    return (
      <span className="text-xs font-medium bg-gray-100 text-gray-400 border border-gray-200 px-2 py-0.5 rounded-full">
        未入力
      </span>
    )
  }
  const days = differenceInDays(parseISO(todayStr), parseISO(hist.lastDate))
  if (days <= 1) {
    return (
      <span className="text-xs font-medium bg-blue-50 text-blue-500 border border-blue-200 px-2 py-0.5 rounded-full">
        昨日入力
      </span>
    )
  }
  return (
    <span className={`text-xs font-medium border px-2 py-0.5 rounded-full whitespace-nowrap
      ${days >= 3 ? 'bg-red-50 text-red-600 border-red-200' : 'bg-orange-50 text-orange-500 border-orange-200'}`}>
      <span className="text-[14px]">{days}</span>日未入力
    </span>
  )
}

// ── 日数（ソート用） ─────────────────────────────────────────
function entryDaysFromInfo(hasToday, hist) {
  if (hasToday) return -1
  if (!hist?.lastDate) return 9999
  return differenceInDays(parseISO(todayStr), parseISO(hist.lastDate))
}

export default function ClientListPage() {
  // ── useState を先に宣言（Reactのhooksルール）──
  const [clients,       setClients]       = useState([])  // 自店舗（super_adminは全店舗）を直接取得した顧客
  const [otherClients,  setOtherClients]  = useState([])  // 他店舗をRPC経由で取得した匿名化済み顧客
  const [otherWeightHistory, setOtherWeightHistory] = useState({}) // 他店舗の体重サマリー・入力状況（client_id→buildOtherStoreWeightInfoの結果）
  const [todayLogs,     setTodayLogs]     = useState({})
  const [todayMeals,    setTodayMeals]    = useState({})
  const [weightHistory, setWeightHistory] = useState({})
  const [commentCounts, setCommentCounts] = useState({})
  const [loading,       setLoading]       = useState(true)
  const [otherLoading,  setOtherLoading]  = useState(false)
  const [otherFetchError, setOtherFetchError] = useState(null) // 他店舗RPCが失敗した場合のみセット（0件とは区別する）
  const [error,         setError]         = useState(null)
  const [showForm,      setShowForm]      = useState(false)
  const [submitting,    setSubmitting]    = useState(false)
  const [toast,         setToast]         = useState(null)
  const [createdCredentials, setCreatedCredentials] = useState(null) // 登録完了後のログイン情報
  const [stores,        setStores]        = useState([])             // 全店舗リスト
  const [selectedStoreId, setSelectedStoreId] = useState(null)      // null=全店舗
  const [storeFilterReady, setStoreFilterReady] = useState(false)   // 初期化完了フラグ
  const [searchParams, setSearchParams] = useSearchParams()
  const [nameHidden, setNameHidden] = useState(readNameHidden)     // 氏名非表示モード（タブ内で維持）

  // データ取得の分岐（自店舗direct／他店舗RPC）に使うため、useState群の直後で呼ぶ
  const { signOut, profile } = useAuth()
  const isSuperAdmin = profile?.is_super_admin === true
  // 他店舗RPC取得の世代カウンタ（店舗切替を連続実行した場合に、古い取得結果を反映しないため）
  const otherFetchGenRef = useRef(0)

  function toggleNameHidden() {
    setNameHidden((prev) => {
      const next = !prev
      writeNameHidden(next)
      return next
    })
  }

  function showToast(type, msg) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }

  // today's weight_logs / meal_logs / 体重履歴 / コメント件数の反映
  // （自店舗direct・super_admin全件directの両方から共通で呼ばれる後処理）
  function applyLogResults(logsRes, mealsRes, wHistRes, commentsRes) {
    if (logsRes.error) {
      console.error('[ClientListPage] today weight_logs fetch error:', logsRes.error)
      setError((prev) => prev ?? `今日の記録の取得に失敗しました：${logsRes.error.message}`)
    } else {
      const map = {}
      logsRes.data.forEach((l) => { map[l.client_id] = l })
      setTodayLogs(map)
    }

    if (mealsRes.error) {
      console.error('[ClientListPage] today meal_logs fetch error:', mealsRes.error)
    } else {
      const map = {}
      mealsRes.data.forEach((m) => { map[m.client_id] = m })
      setTodayMeals(map)
    }

    if (wHistRes.error) {
      // 体重履歴の取得に失敗した場合、「記録なし」として黙って—表示にはしない。
      console.error('[ClientListPage] weight history fetch error:', wHistRes.error)
      setError((prev) => prev ?? `体重履歴の取得に失敗しました：${wHistRes.error.message}`)
    } else {
      const byClient = {}
      wHistRes.data.forEach((l) => {
        ;(byClient[l.client_id] ??= []).push(l)
      })
      const map = {}
      Object.keys(byClient).forEach((clientId) => {
        const rows = byClient[clientId]
        const summary  = computeWeightSummary(rows)
        const lastLog  = findLatestLog(rows) // 体重の有無に関わらず「最後に記録した日」
        map[clientId] = {
          firstKg:   summary.startWeight,
          latestKg:  summary.latestWeight,
          lastDate:  lastLog?.date ?? null,
          latestLog: lastLog,
        }
      })
      setWeightHistory(map)
    }

    // コメント件数（RLS エラーは無視して空として扱う）
    if (commentsRes.error) {
      console.warn('[ClientListPage] admin_comments fetch (non-critical):', commentsRes.error.message)
    } else {
      const map = {}
      commentsRes.data.forEach((c) => { map[c.client_id] = (map[c.client_id] || 0) + 1 })
      setCommentCounts(map)
    }
  }

  // ── 自店舗（super_adminは全店舗）を直接取得 ─────────────────────
  // 他店舗の clients / weight_logs / meal_logs は、この関数では絶対に取得しない。
  async function fetchOwnScopeData() {
    try {
      if (isSuperAdmin) {
        // super_admin：既存どおり全店舗・全情報への直接アクセスを維持する（RPCへは切り替えない）
        const [clientsRes, logsRes, mealsRes, wHistRes, commentsRes] = await Promise.all([
          fetchAllPages((from, to) =>
            supabase.from('clients').select('*').order('kana').order('id').range(from, to)
          ),
          fetchAllPages((from, to) =>
            supabase.from('weight_logs').select('*').eq('date', todayStr).order('id').range(from, to)
          ),
          fetchAllPages((from, to) =>
            supabase.from('meal_logs')
              .select('client_id, breakfast_photo_url, lunch_photo_url, dinner_photo_url, snack_photo_url')
              .eq('date', todayStr).order('id').range(from, to)
          ),
          fetchAllPages((from, to) =>
            supabase.from('weight_logs')
              .select('id, client_id, date, morning_kg, water_ml, sleep_hours, toilet_count, bowel_movement, ate_breakfast, ate_lunch, ate_dinner, ate_snack, comment')
              .order('date', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to)
          ),
          fetchAllPages((from, to) =>
            supabase.from('admin_comments').select('client_id').eq('sender', 'client').order('client_id').range(from, to)
          ),
        ])
        if (clientsRes.error) {
          console.error('[ClientListPage] clients fetch error:', clientsRes.error)
          setError(`顧客一覧の取得に失敗しました：${clientsRes.error.message}`)
        } else {
          setClients(clientsRes.data ?? [])
        }
        applyLogResults(logsRes, mealsRes, wHistRes, commentsRes)
        return
      }

      // 通常admin：自店舗のみを直接取得する（他店舗は fetchOtherScopeData で RPC 経由のみ）
      if (!profile?.store_id) {
        setClients([])
        return
      }
      const clientsRes = await fetchAllPages((from, to) =>
        supabase.from('clients').select('*').eq('store_id', profile.store_id).order('kana').order('id').range(from, to)
      )
      if (clientsRes.error) {
        console.error('[ClientListPage] clients fetch error:', clientsRes.error)
        setError(`顧客一覧の取得に失敗しました：${clientsRes.error.message}`)
        return
      }
      const ownIds = (clientsRes.data ?? []).map((c) => c.id)
      setClients(clientsRes.data ?? [])
      if (ownIds.length === 0) return

      const [logsRes, mealsRes, wHistRes, commentsRes] = await Promise.all([
        fetchAllPages((from, to) =>
          supabase.from('weight_logs').select('*').eq('date', todayStr).in('client_id', ownIds).order('id').range(from, to)
        ),
        fetchAllPages((from, to) =>
          supabase.from('meal_logs')
            .select('client_id, breakfast_photo_url, lunch_photo_url, dinner_photo_url, snack_photo_url')
            .eq('date', todayStr).in('client_id', ownIds).order('id').range(from, to)
        ),
        fetchAllPages((from, to) =>
          supabase.from('weight_logs')
            .select('id, client_id, date, morning_kg, water_ml, sleep_hours, toilet_count, bowel_movement, ate_breakfast, ate_lunch, ate_dinner, ate_snack, comment')
            .in('client_id', ownIds)
            .order('date', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
        ),
        fetchAllPages((from, to) =>
          supabase.from('admin_comments').select('client_id').eq('sender', 'client').in('client_id', ownIds).order('client_id').range(from, to)
        ),
      ])
      applyLogResults(logsRes, mealsRes, wHistRes, commentsRes)
    } catch (err) {
      console.error('[ClientListPage] fetchOwnScopeData unexpected error:', err)
      setError('データの取得中にエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  // ── 他店舗（複数可）を admin_list_other_store_clients RPC 経由で匿名化取得 ──
  // clients / weight_logs / meal_logs への直接アクセスは一切行わない。
  // 一部の店舗の取得が失敗した場合、その店舗だけを黙って一覧から除外しない。
  // 失敗を検知した場合は、成功した店舗分のみ表示しつつ、永続的なエラー表示で
  // 「一覧が不完全である可能性」を明示する（トーストのように自動で消える表示にはしない）。
  async function fetchOtherScopeData(storeIds) {
    const myGen = ++otherFetchGenRef.current
    setOtherLoading(true)
    setOtherFetchError(null)
    try {
      const results = await Promise.all(storeIds.map((sid) => fetchOtherStoreClients(sid)))
      // 取得中に店舗フィルターが変更され、新しい取得が始まっていた場合は結果を反映しない
      if (otherFetchGenRef.current !== myGen) return
      const merged = []
      const historyMap = {}
      let hadError = false
      results.forEach((r) => {
        if (r.error) {
          console.error('[ClientListPage] other-store clients fetch error:', r.error)
          hadError = true
          return
        }
        ;(r.data ?? []).forEach((row) => {
          merged.push(row)
          historyMap[row.client_id] = buildOtherStoreWeightInfo(row)
        })
      })
      // 既存の画面ロジック（c.id 参照）と互換にするため client_id → id を付与する
      setOtherClients(merged.map((r) => ({ ...r, id: r.client_id })))
      setOtherWeightHistory(historyMap)
      if (hadError) {
        setOtherFetchError('他店舗の顧客データの取得に失敗した店舗があります。表示されている他店舗の件数は不完全な可能性があります。')
      }
    } finally {
      if (otherFetchGenRef.current === myGen) setOtherLoading(false)
    }
  }

  useEffect(() => { fetchOwnScopeData() }, [])

  // 店舗リストを取得（一度だけ）
  useEffect(() => {
    supabase.from('stores').select('id, name, code').order('name')
      .then(({ data }) => { if (data) setStores(data) })
  }, [])

  // プロフィール読み込み後、URLのstoreパラメータを優先して店舗フィルタを初期化（一度だけ）。
  // URLに無ければ自店舗をデフォルトにして、履歴を汚さないようreplaceでURLへ反映する。
  useEffect(() => {
    if (!storeFilterReady && profile !== null) {
      const urlStore = searchParams.get(STORE_QUERY_PARAM)
      const initialStoreId = urlStore
        ? (urlStore === STORE_ALL_VALUE ? null : urlStore)
        : (profile?.store_id || null)
      setSelectedStoreId(initialStoreId)
      setStoreFilterReady(true)
      if (!urlStore) {
        const next = new URLSearchParams(searchParams)
        next.set(STORE_QUERY_PARAM, initialStoreId || STORE_ALL_VALUE)
        setSearchParams(next, { replace: true })
      }
    }
  }, [profile, storeFilterReady])

  // 選択中の店舗に応じて、他店舗データ（RPC経由）を取得する。
  // super_admin は RPC を使わず既存の直接アクセスのみで全店舗を見られるため対象外。
  useEffect(() => {
    if (isSuperAdmin) return
    if (!storeFilterReady) return
    if (selectedStoreId === (profile?.store_id || null)) {
      otherFetchGenRef.current++ // 進行中の他店舗取得があれば無効化
      setOtherClients([])
      setOtherWeightHistory({})
      setOtherFetchError(null)
      setOtherLoading(false) // このブロックでは新たな取得を開始しないため、ここで確実に解除する
      return
    }
    if (selectedStoreId === null) {
      const others = stores.filter((s) => s.id !== profile?.store_id).map((s) => s.id)
      if (others.length === 0) {
        otherFetchGenRef.current++
        setOtherClients([])
        setOtherWeightHistory({})
        setOtherFetchError(null)
        setOtherLoading(false) // 同上：取得を開始しないためここで確実に解除する
        return
      }
      fetchOtherScopeData(others)
    } else {
      fetchOtherScopeData([selectedStoreId])
    }
  }, [selectedStoreId, storeFilterReady, isSuperAdmin, profile?.store_id, stores])

  // 店舗選択：state・URL・sessionStorage をまとめて更新
  function selectStore(storeId) {
    setSelectedStoreId(storeId)
    const next = new URLSearchParams(searchParams)
    next.set(STORE_QUERY_PARAM, storeId || STORE_ALL_VALUE)
    setSearchParams(next, { replace: true })
  }

  // 選択中の店舗をセッションに保存（顧客詳細から「戻る」際、履歴が無い場合のフォールバック用）
  useEffect(() => {
    if (storeFilterReady) {
      sessionStorage.setItem(SELECTED_STORE_STORAGE_KEY, selectedStoreId || STORE_ALL_VALUE)
    }
  }, [selectedStoreId, storeFilterReady])

  // 顧客詳細から戻ってきた場合のみ、保存していたスクロール位置を復元する
  // （店舗選択の復元 → 一覧データ取得完了 → 描画完了 の後に実行する）
  useEffect(() => {
    if (loading || !storeFilterReady) return
    const storeKey = selectedStoreId || STORE_ALL_VALUE
    const returnedFrom = sessionStorage.getItem(RETURN_FLAG_STORAGE_KEY)
    if (returnedFrom === storeKey) {
      sessionStorage.removeItem(RETURN_FLAG_STORAGE_KEY)
      const saved = sessionStorage.getItem(scrollPosKey(selectedStoreId))
      if (saved !== null) {
        requestAnimationFrame(() => {
          window.scrollTo(0, parseInt(saved, 10))
        })
      }
    }
  }, [loading, storeFilterReady, selectedStoreId])

  // 顧客行クリック時：詳細から戻ってきたときに復元できるようスクロール位置を保存
  function handleRowClick() {
    sessionStorage.setItem(scrollPosKey(selectedStoreId), String(window.scrollY))
    sessionStorage.setItem(RETURN_FLAG_STORAGE_KEY, selectedStoreId || STORE_ALL_VALUE)
  }

  // 他店舗かどうかを判定（store_id 未設定なら制限なし）
  const isFromOtherStore = (c) => {
    try {
      return Boolean(
        profile?.store_id && c?.store_id &&
        profile.store_id !== c.store_id && !isSuperAdmin
      )
    } catch { return false }
  }

  // 自店舗・他店舗のどちらの顧客でも、体重履歴・今日の記録を同じ形で取り出す。
  // 自店舗の場合は既存の weightHistory/todayLogs/todayMeals（挙動は変更しない）、
  // 他店舗の場合は otherWeightHistory（buildOtherStoreWeightInfoの結果）から組み立てる。
  function resolveWeightInfo(c) {
    if (isFromOtherStore(c)) {
      const info = otherWeightHistory[c.id]
      return {
        hist:      info ? { firstKg: info.firstKg, latestKg: info.latestKg, lastDate: info.lastDate, latestLog: info.latestLog } : null,
        hasToday:  Boolean(info?.todayLog),
        todayLog:  info?.todayLog ?? null,
        todayMeal: info?.todayMeal ?? null,
      }
    }
    return {
      hist:      weightHistory[c.id] ?? null,
      hasToday:  Boolean(todayLogs[c.id]),
      todayLog:  todayLogs[c.id] ?? null,
      todayMeal: todayMeals[c.id] ?? null,
    }
  }

  // 表示対象：自店舗（またはsuper_adminの全件）＋ 選択中の他店舗（RPC取得分）
  const allClients = isSuperAdmin ? clients : [...clients, ...otherClients]

  // 選択店舗でフィルタ
  const filteredClients = selectedStoreId === null
    ? allClients                                                // 全店舗
    : allClients.filter(c => c.store_id === selectedStoreId)   // 特定店舗のみ

  // 自店舗かどうかの確認（新規登録ボタン表示・保存処理の両方で使用）
  const canRegister = Boolean(
    profile?.store_id &&
    selectedStoreId === profile.store_id
  )

  async function handleCreate(payload) {
    // 安全対策：自店舗以外への登録を禁止
    if (!profile?.store_id) {
      showToast('error', '店舗が設定されていないため登録できません')
      return
    }
    if (selectedStoreId !== profile.store_id) {
      showToast('error', '自店舗以外への新規登録はできません')
      return
    }

    setSubmitting(true)

    // store_id は必ず自分の店舗（selectedStoreId は使わない）
    const createPayload = { ...payload, store_id: profile.store_id }

    // 顧客番号を自動採番（店舗コードごとの採番台帳から「最大番号+1」を取得。
    // 削除済み番号は台帳に残り続けるため再利用されない）
    const storeRes = await supabase.from('stores').select('code').eq('id', profile.store_id).single()
    let customerNumber = null
    if (!storeRes.error && storeRes.data?.code) {
      const { data: nextNumber, error: numError } = await supabase
        .rpc('next_customer_number', { p_store_code: storeRes.data.code })
      if (numError || !nextNumber) {
        setSubmitting(false)
        showToast('error', `顧客番号の採番に失敗しました：${numError?.message || '不明なエラー'}`)
        return
      }
      customerNumber = nextNumber
      createPayload.customer_number = customerNumber
    }

    const { error, data } = await supabase.from('clients').insert(createPayload).select().single()
    if (error) {
      setSubmitting(false)
      showToast('error', `登録に失敗しました：${error.message}`)
      return
    }

    // Edge Function でログインアカウントを作成（顧客番号 + 誕生日8桁）
    let credentials = null
    if (customerNumber && payload.birthdate) {
      const { data: fnData, error: fnError } = await supabase.functions.invoke('create-patient-user', {
        body: {
          client_id: data.id,
          customer_number: customerNumber,
          birthdate: payload.birthdate,
          store_id: profile.store_id,
        },
      })
      if (fnError || fnData?.error) {
        showToast('error', `ログインアカウント作成に失敗：${fnData?.error || fnError.message}（顧客情報は登録済みです）`)
      } else {
        credentials = fnData
      }
    }

    setSubmitting(false)
    setShowForm(false)
    if (credentials) {
      setCreatedCredentials({ name: data.name, ...credentials })
    } else {
      showToast('success', `${data.name} さんを登録しました`)
    }
    fetchOwnScopeData()
  }

  // ── ソート：未入力日数が多い順 → 今日入力済みはスコア低い順 → 終了者は末尾 ──
  const sorted = [...filteredClients].sort((a, b) => {
    const aActive = a.is_active !== false
    const bActive = b.is_active !== false
    if (aActive !== bActive) return aActive ? -1 : 1
    if (!aActive) return (a.kana || a.name || '').localeCompare(b.kana || b.name || '', 'ja')
    const infoA = resolveWeightInfo(a)
    const infoB = resolveWeightInfo(b)
    const aDays = entryDaysFromInfo(infoA.hasToday, infoA.hist)
    const bDays = entryDaysFromInfo(infoB.hasToday, infoB.hist)
    if (aDays !== bDays) return bDays - aDays // 日数多い順
    if (aDays === -1) { // 両方today入力済み → スコア低い順
      // 自店舗・他店舗どちらでも安全なよう、resolveWeightInfo で解決済みの
      // todayLog/todayMeal を使う（生の todayLogs/todayMeals は自店舗専用のmapで、
      // 他店舗の client_id では常に undefined になり evaluateLog がクラッシュするため使わない）。
      const sa = evaluateLog(infoA.todayLog, null, infoA.todayMeal).score
      const sb = evaluateLog(infoB.todayLog, null, infoB.todayMeal).score
      return sa - sb
    }
    return 0
  })

  // 今日の入力状況サマリー：現在表示中（＝取得に成功した）顧客全員で集計する。
  // 取得に失敗した店舗の顧客はそもそも otherClients に含まれないため、
  // filteredClients に含まれる時点で正常取得済みであることが保証される。
  const dataAvailableClients = filteredClients
  const inputtedCount = dataAvailableClients.filter((c) => resolveWeightInfo(c).hasToday).length
  const notInputted   = dataAvailableClients.length - inputtedCount

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium
          ${toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}

      {/* 登録完了：ログイン情報モーダル */}
      {createdCredentials && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="text-center mb-4">
              <p className="text-3xl mb-2">✅</p>
              <h2 className="text-lg font-bold text-gray-800">
                {createdCredentials.name} さんを登録しました
              </h2>
              <p className="text-xs text-gray-400 mt-1">ログイン情報を控えてお渡しください</p>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-4 space-y-3">
              <div>
                <p className="text-xs text-blue-600 font-bold">ログインURL</p>
                <p className="text-sm font-medium text-gray-800 break-all">{window.location.origin}/login</p>
              </div>
              <div>
                <p className="text-xs text-blue-600 font-bold">ログインID</p>
                <p className="text-2xl font-black text-gray-800">{createdCredentials.login_id}</p>
              </div>
              <div>
                <p className="text-xs text-blue-600 font-bold">初期パスワード</p>
                <p className="text-2xl font-black text-gray-800">{createdCredentials.password}</p>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-3 text-center">この情報を患者様へお渡しください</p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(
                    `ログインURL\n${window.location.origin}/login\n\nログインID\n${createdCredentials.login_id}\n\n初期パスワード\n${createdCredentials.password}`
                  )
                  showToast('success', 'コピーしました')
                }}
                className="flex-1 bg-white border border-blue-300 text-blue-600 font-bold py-3 rounded-xl hover:bg-blue-50 transition-colors"
              >
                コピー
              </button>
              <button
                onClick={() => setCreatedCredentials(null)}
                className="flex-1 bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition-colors"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">お客さん一覧</h1>
          <p className="text-sm text-gray-500 mt-0.5">整骨院体重管理システム</p>
        </div>
        <div className="flex items-center gap-3">
          {/* 氏名の表示・非表示切替（来院中の顧客に他の方のデータを見せる際の目隠し用） */}
          <button onClick={toggleNameHidden}
            className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors inline-flex items-center gap-1.5
              ${nameHidden
                ? 'bg-slate-700 text-white border-slate-700 hover:bg-slate-800'
                : 'bg-white text-slate-600 border-gray-200 hover:bg-gray-50'}`}>
            {nameHidden ? '👁️ 氏名を表示' : '🙈 氏名を非表示'}
          </button>
          {/* 自店舗表示中のみ新規登録ボタンを表示 */}
          {canRegister && (
            <button onClick={() => setShowForm(true)}
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              ＋ 新規登録
            </button>
          )}
          <BackButton to="/" label="チェッカー" variant="dark" />
          <button onClick={signOut}
            className="text-sm text-gray-400 hover:text-red-500 transition-colors px-3 py-1.5 border border-gray-200 rounded-lg hover:border-red-200">
            ログアウト
          </button>
        </div>
      </header>

      {nameHidden && (
        <div className="bg-slate-700 text-white text-xs font-medium text-center py-1.5 px-4">
          🙈 氏名非表示モード中
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-5">お客さん新規登録</h2>
            <ClientForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} submitting={submitting} />
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            <strong>エラー：</strong> {error}
          </div>
        )}
        {otherFetchError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            <strong>エラー：</strong> {otherFetchError}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* ── 店舗フィルター（グループ表示） ── */}
            {stores.length > 0 && (() => {
              const ownStore   = stores.find(s => s.id === profile?.store_id)
              const otherStores = stores.filter(s => s.id !== profile?.store_id)
              const btnCls = (active) =>
                `px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors whitespace-nowrap
                 ${active
                   ? 'bg-blue-600 text-white border-blue-600'
                   : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`
              return (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 mb-4 space-y-2">
                  {/* 自店舗 */}
                  {ownStore && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-400 w-20 flex-shrink-0">自店舗</span>
                      <button
                        onClick={() => selectStore(ownStore.id)}
                        className={btnCls(selectedStoreId === ownStore.id)}
                      >
                        {ownStore.name}
                      </button>
                    </div>
                  )}
                  {/* 他店舗閲覧 */}
                  {otherStores.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-gray-400 w-20 flex-shrink-0">他店舗閲覧</span>
                      <div className="flex gap-2 flex-wrap">
                        {otherStores.map(s => (
                          <button key={s.id}
                            onClick={() => selectStore(s.id)}
                            className={btnCls(selectedStoreId === s.id)}
                          >
                            {s.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 全店舗 */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-400 w-20 flex-shrink-0">全体</span>
                    <button
                      onClick={() => selectStore(null)}
                      className={btnCls(selectedStoreId === null)}
                    >
                      全店舗
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* サマリーバー（現在表示中＝取得に成功した顧客全員で集計） */}
            {dataAvailableClients.length > 0 && (
              <div className="flex items-center gap-3 mb-4 px-1 flex-wrap">
                <p className="text-sm text-gray-500">
                  今日（{format(new Date(), 'M月d日')}）の入力：
                  <span className="font-bold text-blue-600 ml-1">{inputtedCount}人</span>
                  <span className="text-gray-400"> / {dataAvailableClients.length}人入力済</span>
                </p>
                {notInputted > 0 && (
                  <span className="text-xs font-medium text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
                    {notInputted}人が未入力
                  </span>
                )}
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {otherLoading ? (
                <div className="flex justify-center py-16">
                  <div className="w-6 h-6 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
                </div>
              ) : filteredClients.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <p className="text-base">この店舗にはお客さんが登録されていません</p>
                </div>
              ) : (
                <>
                  {/* ── 見出し行（PCのみ） ── */}
                  <div className="hidden md:grid grid-cols-[2fr_0.85fr_0.85fr_0.85fr_1.5fr_20px] gap-x-4 px-5 py-2.5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500">
                    <span>顧客</span>
                    <span className="text-right">開始体重</span>
                    <span className="text-right">最新体重</span>
                    <span className="text-right">体重差</span>
                    <span className="text-right">入力状況・注意</span>
                    <span />
                  </div>

                  {(() => {
                    return sorted.map((c, idx) => {
                      const otherStore = isFromOtherStore(c)
                      const weightInfo = resolveWeightInfo(c)
                      const wLog       = weightInfo.todayLog
                      const mLog       = weightInfo.todayMeal
                      const hist       = weightInfo.hist
                      const commCnt    = commentCounts[c.id] ?? 0
                      const isInactive = c.is_active === false
                      const clientStore = stores.find(s => s.id === c.store_id)

                      // 他店舗閲覧時も氏名・かな・UUIDは表示しない。仮名（匿名顧客N）も一覧では表示せず、
                      // 顧客番号のみを識別情報として表示する（顧客番号が無い場合は欠損表示「—」にする。
                      // 実名・仮名へのフォールバックはしない）。
                      const numberLabel = c.customer_number || (otherStore ? '—' : null)
                      const nameLabel   = otherStore
                        ? null
                        : nameHidden ? '氏名非表示' : c.name
                      const displaySub  = otherStore
                        ? (clientStore ? clientStore.name : c.store_name || '他店舗')
                        : nameHidden ? null : c.kana

                      // 最新スコア：自店舗・他店舗ともresolveWeightInfoで解決した値から同じ計算をする
                      const scoreLog   = wLog ?? hist?.latestLog ?? null
                      const scoreMeal  = wLog ? mLog : null
                      const scoreEval  = scoreLog ? evaluateLog(scoreLog, null, scoreMeal) : null
                      const scoreVal   = scoreEval ? scoreEval.score : null
                      const scoreClr   = scoreEval ? (scoreEval.isToday ? pendingColor() : scoreColor(scoreVal)) : null
                      const scoreLbl   = scoreEval ? (scoreEval.isToday ? '入力途中' : scoreLabel(scoreVal)) : null
                      const scoreDateLabel = scoreEval && !scoreEval.isToday && scoreLog?.date
                        ? `${format(parseISO(scoreLog.date), 'M月d日')}の評価`
                        : null

                      // 進捗
                      const firstKg   = hist?.firstKg  ?? null
                      const latestKg  = wLog?.morning_kg ?? hist?.latestKg ?? null
                      const totalDiff = firstKg && latestKg ? +(latestKg - firstKg).toFixed(1) : null
                      const toGoal    = c.goal_weight && latestKg ? +(latestKg - c.goal_weight).toFixed(1) : null
                      const toGoalNode = toGoal !== null && (
                        toGoal <= 0
                          ? <span className="text-green-600 font-medium">達成！</span>
                          : <>-{toGoal}kg</>
                      )

                      // 入力状況・スコアバッジ：自店舗・他店舗とも同じ部品・判定で表示する
                      // （他店舗はweightInfoがresolveWeightInfo経由で解決済みのため、EntryBadgeが
                      //   誤って「未入力」を出すことはない）
                      const statusBadges = (
                        <>
                          <EntryBadge hasToday={weightInfo.hasToday} hist={hist} />
                          {scoreVal !== null && (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${scoreClr.bg} ${scoreClr.text} ${scoreClr.border}`}>
                              <span className="text-[14px]">{scoreVal}</span>点 {scoreLbl}
                            </span>
                          )}
                          {scoreDateLabel && (
                            <span className="text-[10px] text-gray-400 whitespace-nowrap">{scoreDateLabel}</span>
                          )}
                        </>
                      )
                      const subBadges = (
                        <>
                          {isInactive && (
                            <span className="text-xs font-medium text-gray-500 bg-gray-100 border border-gray-300 px-2 py-0.5 rounded-full whitespace-nowrap">
                              終了
                            </span>
                          )}
                          {!otherStore && commCnt > 0 && (
                            <span className="text-xs font-bold bg-green-500 text-white px-2 py-0.5 rounded-full whitespace-nowrap">
                              コメント <span className="text-[14px]">{commCnt}</span>件
                            </span>
                          )}
                        </>
                      )

                      return (
                        <Link
                          key={c.id}
                          to={`/admin/clients/${c.id}`}
                          state={{ fromList: true, isOtherStore: otherStore }}
                          onClick={handleRowClick}
                          className={`group block border-b border-gray-100 last:border-b-0 transition-colors hover:bg-blue-50/70 ${idx % 2 === 1 ? 'bg-gray-50/60' : 'bg-white'} ${isInactive ? 'opacity-60' : ''}`}
                        >
                          {/* ── スマートフォン表示（2〜3段） ── */}
                          <div className="md:hidden px-4 py-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-baseline gap-2 min-w-0">
                                {numberLabel && <span className="text-sm font-semibold text-gray-400 flex-shrink-0">{numberLabel}</span>}
                                {nameLabel && (
                                  <span className="text-[19px] font-normal text-gray-900 truncate flex items-center gap-1">
                                    {!otherStore && !isInactive && <span className="text-red-500 text-xs flex-shrink-0">●</span>}
                                    <span className="truncate">{nameLabel}</span>
                                  </span>
                                )}
                              </div>
                              <span className="text-gray-300 text-lg flex-shrink-0">›</span>
                            </div>
                            {displaySub && <p className="text-xs text-gray-400 mt-0.5 truncate">{displaySub}</p>}
                            {(firstKg != null || latestKg != null || totalDiff !== null) && (
                              <div className="flex items-center gap-3 text-sm text-gray-700 mt-1.5 flex-wrap">
                                {firstKg  != null && <span>開始 <span className="text-[18px] font-semibold text-gray-900">{firstKg}kg</span></span>}
                                {latestKg != null && <span>最新 <span className="text-[18px] font-semibold text-gray-900">{latestKg}kg</span></span>}
                                {totalDiff !== null && (
                                  <span>
                                    差{' '}
                                    <span className={`text-[18px] font-normal ${totalDiff < 0 ? 'text-red-500' : totalDiff > 0 ? 'text-gray-900' : 'text-gray-500'}`}>
                                      {totalDiff >= 0 ? '+' : ''}{totalDiff}kg
                                    </span>
                                  </span>
                                )}
                                {toGoalNode && <span className="text-xs text-gray-400">目標まで {toGoalNode}</span>}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              {statusBadges}
                              {subBadges}
                            </div>
                          </div>

                          {/* ── PC表示（表形式） ── */}
                          <div className="hidden md:grid grid-cols-[2fr_0.85fr_0.85fr_0.85fr_1.5fr_20px] items-center gap-x-4 px-5 min-h-[78px]">
                            <div className="min-w-0 flex items-baseline gap-2.5">
                              {numberLabel && <span className="text-[15px] font-semibold text-gray-400 flex-shrink-0">{numberLabel}</span>}
                              <div className="min-w-0">
                                {nameLabel && (
                                  <p className="text-[20px] font-normal text-gray-900 truncate flex items-center gap-1.5">
                                    {!otherStore && !isInactive && <span className="text-red-500 text-xs flex-shrink-0">●</span>}
                                    {nameLabel}
                                  </p>
                                )}
                                {displaySub && <p className="text-xs text-gray-400 truncate">{displaySub}</p>}
                              </div>
                            </div>
                            <div className="text-right text-[20px] font-medium text-gray-900">
                              {firstKg != null ? `${firstKg}kg` : <span className="text-gray-300 font-normal">—</span>}
                            </div>
                            <div className="text-right text-[20px] font-medium text-gray-900">
                              {latestKg != null ? `${latestKg}kg` : <span className="text-gray-300 font-normal">—</span>}
                            </div>
                            <div className="text-right">
                              <p className="text-[20px] font-normal">
                                {totalDiff !== null
                                  ? <span className={totalDiff < 0 ? 'text-red-500' : totalDiff > 0 ? 'text-gray-900' : 'text-gray-500'}>{totalDiff >= 0 ? '+' : ''}{totalDiff}kg</span>
                                  : <span className="text-gray-300 font-normal">—</span>}
                              </p>
                              {toGoalNode && <p className="text-[11px] text-gray-400 mt-0.5 whitespace-nowrap">目標まで {toGoalNode}</p>}
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex items-center gap-1.5 flex-wrap justify-end">{statusBadges}</div>
                              {(isInactive || (!otherStore && commCnt > 0)) && (
                                <div className="flex items-center gap-1.5 flex-wrap justify-end">{subBadges}</div>
                              )}
                            </div>
                            <div className="text-right text-gray-300 text-lg group-hover:text-blue-400 transition-colors">›</div>
                          </div>
                        </Link>
                      )
                    })
                  })()}
                </>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
