import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import BackButton from '../../components/BackButton'
import { format, differenceInDays, parseISO } from 'date-fns'
import { supabase }  from '../../lib/supabase'
import ClientForm    from '../../components/admin/ClientForm'
import { useAuth }   from '../../contexts/AuthContext'
import { evaluateLog, scoreColor, scoreLabel } from '../../lib/evaluateLog'

const todayStr = format(new Date(), 'yyyy-MM-dd')

// ── 入力状況バッジ ────────────────────────────────────────────
function EntryBadge({ clientId, todayLogs, weightHistory }) {
  if (todayLogs[clientId]) {
    return (
      <span className="text-xs font-medium bg-green-50 text-green-600 border border-green-200 px-2 py-0.5 rounded-full whitespace-nowrap">
        今日入力済み
      </span>
    )
  }
  const hist = weightHistory[clientId]
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
      {days}日未入力
    </span>
  )
}

// ── 日数（ソート用） ─────────────────────────────────────────
function entryDays(clientId, todayLogs, weightHistory) {
  if (todayLogs[clientId]) return -1
  const hist = weightHistory[clientId]
  if (!hist?.lastDate) return 9999
  return differenceInDays(parseISO(todayStr), parseISO(hist.lastDate))
}

export default function ClientListPage() {
  // ── useState を先に宣言（Reactのhooksルール）──
  const [clients,       setClients]       = useState([])
  const [todayLogs,     setTodayLogs]     = useState({})
  const [todayMeals,    setTodayMeals]    = useState({})
  const [weightHistory, setWeightHistory] = useState({})
  const [commentCounts, setCommentCounts] = useState({})
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  const [showForm,      setShowForm]      = useState(false)
  const [submitting,    setSubmitting]    = useState(false)
  const [toast,         setToast]         = useState(null)
  const [createdCredentials, setCreatedCredentials] = useState(null) // 登録完了後のログイン情報
  const [stores,        setStores]        = useState([])             // 全店舗リスト
  const [selectedStoreId, setSelectedStoreId] = useState(null)      // null=全店舗
  const [storeFilterReady, setStoreFilterReady] = useState(false)   // 初期化完了フラグ

  async function fetchAll() {
    try {
      const [clientsRes, logsRes, mealsRes, wHistRes, commentsRes] = await Promise.all([
        supabase.from('clients').select('*').order('kana'),
        supabase.from('weight_logs').select('*').eq('date', todayStr),
        supabase.from('meal_logs')
          .select('client_id, breakfast_photo_url, lunch_photo_url, dinner_photo_url, snack_photo_url')
          .eq('date', todayStr),
        supabase.from('weight_logs')
          .select('client_id, date, morning_kg, water_ml, sleep_hours, toilet_count, bowel_movement, ate_breakfast, ate_lunch, ate_dinner, ate_snack, comment')
          .order('date', { ascending: true }),
        // コメント件数（RLS エラーでも空配列として扱う）
        supabase.from('admin_comments').select('client_id').eq('sender', 'client'),
      ])

      if (clientsRes.error) {
        console.error('clients fetch error:', clientsRes.error)
        setError(clientsRes.error.message)
      } else {
        setClients(clientsRes.data ?? [])
      }

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
      if (!wHistRes.error && wHistRes.data) {
        const map = {}
        wHistRes.data.forEach((l) => {
          if (!map[l.client_id]) {
            map[l.client_id] = { firstKg: null, latestKg: null, lastDate: null, latestLog: null }
          }
          const e = map[l.client_id]
          if (l.morning_kg != null && !e.firstKg) e.firstKg = l.morning_kg
          if (l.morning_kg != null) e.latestKg = l.morning_kg
          e.lastDate  = l.date
          e.latestLog = l
        })
        setWeightHistory(map)
      }
      // コメント件数（RLS エラーは無視して空として扱う）
      if (!commentsRes.error && commentsRes.data) {
        const map = {}
        commentsRes.data.forEach((c) => { map[c.client_id] = (map[c.client_id] || 0) + 1 })
        setCommentCounts(map)
      } else if (commentsRes.error) {
        console.warn('admin_comments fetch (non-critical):', commentsRes.error.message)
      }
    } catch (err) {
      console.error('fetchAll unexpected error:', err)
      setError('データの取得中にエラーが発生しました')
    } finally {
      setLoading(false)  // 必ず loading を解除
    }
  }

  useEffect(() => { fetchAll() }, [])

  // 店舗リストを取得（一度だけ）
  useEffect(() => {
    supabase.from('stores').select('id, name, code').order('name')
      .then(({ data }) => { if (data) setStores(data) })
  }, [])

  // ── useAuth は useState / useEffect の後（hooks の順序維持）──
  const { signOut, profile } = useAuth()
  const isSuperAdmin = profile?.is_super_admin === true

  // プロフィール読み込み後に自店舗をデフォルトフィルタとして設定（一度だけ）
  useEffect(() => {
    if (!storeFilterReady && profile !== null) {
      setSelectedStoreId(profile?.store_id || null)
      setStoreFilterReady(true)
    }
  }, [profile, storeFilterReady])

  // 他店舗かどうかを判定（store_id 未設定なら制限なし）
  const isFromOtherStore = (c) => {
    try {
      return Boolean(
        profile?.store_id && c?.store_id &&
        profile.store_id !== c.store_id && !isSuperAdmin
      )
    } catch { return false }
  }

  // 選択店舗でフィルタ
  const filteredClients = selectedStoreId === null
    ? clients                                                  // 全店舗
    : clients.filter(c => c.store_id === selectedStoreId)     // 特定店舗のみ

  function showToast(type, msg) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }

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
    fetchAll()
  }

  // ── ソート：未入力日数が多い順 → 今日入力済みはスコア低い順 → 終了者は末尾 ──
  const sorted = [...filteredClients].sort((a, b) => {
    const aActive = a.is_active !== false
    const bActive = b.is_active !== false
    if (aActive !== bActive) return aActive ? -1 : 1
    if (!aActive) return (a.kana || a.name).localeCompare(b.kana || b.name, 'ja')
    const aDays = entryDays(a.id, todayLogs, weightHistory)
    const bDays = entryDays(b.id, todayLogs, weightHistory)
    if (aDays !== bDays) return bDays - aDays // 日数多い順
    if (aDays === -1) { // 両方today入力済み → スコア低い順
      const sa = evaluateLog(todayLogs[a.id], null, todayMeals[a.id]).score
      const sb = evaluateLog(todayLogs[b.id], null, todayMeals[b.id]).score
      return sa - sb
    }
    return 0
  })

  const inputtedCount = filteredClients.filter((c) => todayLogs[c.id]).length
  const notInputted   = filteredClients.length - inputtedCount

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

      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-5">お客さん新規登録</h2>
            <ClientForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} submitting={submitting} requireBirthdate />
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
                        onClick={() => setSelectedStoreId(ownStore.id)}
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
                            onClick={() => setSelectedStoreId(s.id)}
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
                      onClick={() => setSelectedStoreId(null)}
                      className={btnCls(selectedStoreId === null)}
                    >
                      全店舗
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* サマリーバー */}
            <div className="flex items-center gap-3 mb-4 px-1 flex-wrap">
              <p className="text-sm text-gray-500">
                今日（{format(new Date(), 'M月d日')}）の入力：
                <span className="font-bold text-blue-600 ml-1">{inputtedCount}人</span>
                <span className="text-gray-400"> / {filteredClients.length}人入力済</span>
              </p>
              {notInputted > 0 && (
                <span className="text-xs font-medium text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
                  {notInputted}人が未入力
                </span>
              )}
            </div>

            <div className="grid gap-3">
              {sorted.map((c) => {
                const wLog       = todayLogs[c.id]     ?? null
                const mLog       = todayMeals[c.id]    ?? null
                const hist       = weightHistory[c.id] ?? null
                const commCnt    = commentCounts[c.id] ?? 0
                const otherStore = isFromOtherStore(c)
                const isInactive = c.is_active === false
                const cnum = c.customer_number || ''
                // 他店舗: 顧客番号 + 店舗名。自店舗: 顧客番号 + 氏名
                const clientStore = stores.find(s => s.id === c.store_id)
                const displayName  = otherStore
                  ? (cnum || `ID-${c.id.slice(0, 6)}`)
                  : (cnum ? `${cnum} ${c.name}` : c.name)
                const displaySub   = otherStore
                  ? (clientStore ? clientStore.name : '他店舗')
                  : c.kana
                const avatarLetter = otherStore ? (cnum.slice(0, 1) || '#') : (c.name?.charAt(0) || '?')

                // 最新スコア：今日のログがあればそれを使用、なければ最新ログ
                const scoreLog  = wLog ?? hist?.latestLog ?? null
                const scoreMeal = wLog ? mLog : null
                const scoreVal  = scoreLog ? evaluateLog(scoreLog, null, scoreMeal).score : null
                const scoreClr  = scoreVal !== null ? scoreColor(scoreVal) : null

                // 進捗
                const firstKg   = hist?.firstKg  ?? null
                const latestKg  = wLog?.morning_kg ?? hist?.latestKg ?? null
                const totalDiff = firstKg && latestKg ? +(latestKg - firstKg).toFixed(1) : null
                const toGoal    = c.goal_weight && latestKg ? +(latestKg - c.goal_weight).toFixed(1) : null

                return (
                  <Link
                    key={c.id}
                    to={`/admin/clients/${c.id}`}
                    className={`bg-white rounded-xl border border-gray-200 px-5 py-4 hover:border-blue-300 hover:shadow-sm transition-all ${isInactive ? 'opacity-70' : ''}`}
                  >
                    {/* 上段：名前 + バッジ群 */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${otherStore ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-700'}`}>
                          {avatarLetter}
                        </div>
                        <div className="min-w-0">
                          <p className={`font-semibold flex items-center gap-1.5 text-sm ${isInactive ? 'text-gray-500' : 'text-gray-800'}`}>
                            {!otherStore && !isInactive && <span className="text-red-500 text-xs">●</span>}
                            {displayName}
                          </p>
                          {displaySub && <p className={`text-xs ${otherStore ? 'text-orange-400' : 'text-gray-400'}`}>{displaySub}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {/* 終了バッジ */}
                        {isInactive && (
                          <span className="text-xs font-medium text-gray-500 bg-gray-100 border border-gray-300 px-2 py-0.5 rounded-full">
                            終了
                          </span>
                        )}
                        {/* コメントバッジ（他店舗は非表示） */}
                        {!otherStore && commCnt > 0 && (
                          <span className="text-xs font-bold bg-green-500 text-white px-2 py-0.5 rounded-full">
                            コメント {commCnt}件
                          </span>
                        )}
                        {/* 入力状況バッジ */}
                        <EntryBadge clientId={c.id} todayLogs={todayLogs} weightHistory={weightHistory} />
                        {/* スコアバッジ */}
                        {scoreVal !== null && (
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${scoreClr.bg} ${scoreClr.text} ${scoreClr.border}`}>
                            {scoreVal}点 {scoreLabel(scoreVal)}
                          </span>
                        )}
                        <span className="text-gray-300 text-base">›</span>
                      </div>
                    </div>

                    {/* 下段：進捗サマリー */}
                    {(firstKg || latestKg || c.goal_weight) && (
                      <div className="flex items-center gap-3 text-xs text-gray-500 ml-11 flex-wrap">
                        {firstKg   && <span>開始 <span className="font-medium text-gray-700">{firstKg}kg</span></span>}
                        {latestKg  && <span>最新 <span className="font-medium text-gray-700">{latestKg}kg</span></span>}
                        {totalDiff !== null && (
                          <span className={`font-bold ${totalDiff < 0 ? 'text-green-600' : totalDiff > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                            {totalDiff >= 0 ? '+' : ''}{totalDiff}kg
                          </span>
                        )}
                        {toGoal !== null && (
                          <span>
                            目標まで{' '}
                            <span className={`font-medium ${toGoal <= 0 ? 'text-green-600' : 'text-gray-700'}`}>
                              {toGoal <= 0 ? '達成！' : `-${toGoal}kg`}
                            </span>
                          </span>
                        )}
                      </div>
                    )}
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
