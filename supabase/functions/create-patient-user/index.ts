// Supabase Edge Function: 顧客番号＋誕生日で患者ログインアカウントを作成
// デプロイ: supabase functions deploy create-patient-user
//
// 呼び出し元は、対象顧客と同一店舗の admin、または is_super_admin の管理者に限定する。
// 認証・店舗権限チェックは supabase/functions/_shared/auth.ts の requireAdmin が行う。
// customer_number・birthdate・store_id はリクエストbodyの値を信頼せず、
// 必ず clients テーブルから取得した値のみを使用する。
import { corsHeaders, jsonHeaders } from '../_shared/cors.ts'
import { requireAdmin } from '../_shared/auth.ts'

const MAX_CLIENT_ID_LENGTH = 128
const CONFLICT_MESSAGE = 'このアカウントは既に登録されています。管理者へご確認ください。'
const INCONSISTENT_MESSAGE = '既に登録されたアカウントの情報に不整合があります。管理者へご確認ください。'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: '許可されていないメソッドです' }), {
      status: 405,
      headers: { ...jsonHeaders(), 'Allow': 'POST, OPTIONS' },
    })
  }

  // ── リクエストbodyを安全に解析 ──────────────────────────────
  // customer_number / birthdate / store_id が含まれていても、
  // このFunctionのアカウント作成処理では一切使用しない（すべて clients テーブルから取得する）
  let client_id: unknown
  try {
    const body = await req.json()
    client_id = body?.client_id
  } catch {
    return new Response(JSON.stringify({ error: 'リクエストの解析に失敗しました' }),
      { status: 400, headers: jsonHeaders() })
  }

  if (typeof client_id !== 'string' || client_id.trim() === '' || client_id.length > MAX_CLIENT_ID_LENGTH) {
    return new Response(JSON.stringify({ error: 'client_id は必須です' }),
      { status: 400, headers: jsonHeaders() })
  }
  client_id = client_id.trim() // 以降の問い合わせは必ずtrim後の値を使う

  // ── 認証・店舗権限確認（ここまでは service role による変更処理を一切行わない）──
  const auth = await requireAdmin(req, client_id)
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }),
      { status: auth.status, headers: jsonHeaders() })
  }

  try {
    const admin = auth.serviceClient

    // 顧客の正式情報を clients テーブルから取得する（bodyのcustomer_number/birthdate/store_idは使わない）
    const { data: client, error: clientErr } = await admin
      .from('clients')
      .select('id, customer_number, birthdate, store_id')
      .eq('id', client_id)
      .single()

    if (clientErr || !client) {
      console.error('[create-patient-user] clients取得エラー:', clientErr?.message ?? '該当データなし')
      return new Response(JSON.stringify({ error: '顧客情報の取得に失敗しました' }),
        { status: 500, headers: jsonHeaders() })
    }

    const customerNumber = typeof client.customer_number === 'string' ? client.customer_number.trim() : ''
    if (!customerNumber) {
      return new Response(JSON.stringify({ error: '顧客番号が登録されていません' }),
        { status: 400, headers: jsonHeaders() })
    }
    if (!client.birthdate) {
      return new Response(JSON.stringify({ error: '生年月日が登録されていません' }),
        { status: 400, headers: jsonHeaders() })
    }

    const password = client.birthdate.replace(/-/g, '') // YYYY-MM-DD → YYYYMMDD
    if (!/^\d{8}$/.test(password)) {
      console.error('[create-patient-user] 生年月日の形式が不正です')
      return new Response(JSON.stringify({ error: '生年月日の形式が不正です' }),
        { status: 400, headers: jsonHeaders() })
    }

    if (!client.store_id) {
      console.error('[create-patient-user] store_id未設定のため停止しました')
      return new Response(JSON.stringify({ error: '店舗情報が未設定のため発行できません' }),
        { status: 400, headers: jsonHeaders() })
    }

    // requireAdmin で確認済みの store_id と、ここで再取得した store_id の整合性確認（念のための防御）
    if (auth.targetClient && auth.targetClient.store_id !== client.store_id) {
      console.error('[create-patient-user] store_idの整合性確認に失敗しました')
      return new Response(JSON.stringify({ error: 'この操作を実行する権限がありません' }),
        { status: 403, headers: jsonHeaders() })
    }

    const email = `${customerNumber.toLowerCase()}@patient.internal`

    // ── 既存プロフィールの確認（存在する場合は、安全に確認できた場合だけ「発行済み」を返す）──
    const { data: existingProfile, error: existingErr } = await admin
      .from('profiles')
      .select('id, role, client_id, store_id')
      .eq('client_id', client_id)
      .eq('role', 'client')
      .maybeSingle()

    if (existingErr) {
      console.error('[create-patient-user] profiles確認エラー:', existingErr.message)
      return new Response(JSON.stringify({ error: 'アカウント確認中にエラーが発生しました' }),
        { status: 500, headers: jsonHeaders() })
    }

    if (existingProfile) {
      // 基本項目の整合性（クエリのfilterと重複するが、明示的に再確認する）
      const basicMatch =
        existingProfile.role === 'client' &&
        existingProfile.client_id === client_id &&
        existingProfile.store_id === client.store_id

      let authUserMatch = false
      let authCheckFailed = false // Authサービス側の未分類/一時的な障害（不整合と断定しない）→500

      if (basicMatch) {
        const { data: existingAuthUser, error: authLookupErr } = await admin.auth.admin.getUserById(existingProfile.id)

        if (authLookupErr) {
          // 分類の優先順位：1. code  2. name  3. status（補助情報）  4. message（他に手段がない場合の最後の補助）
          // 「不存在」の判定は原則 code === 'user_not_found' のみで行い、message文字列には依存しない。
          const details = authLookupErr as { code?: string; name?: string; status?: number }
          if (details.code === 'user_not_found') {
            console.error('[create-patient-user] 既存プロフィールに対応するAuthユーザーが見つかりません')
          } else {
            // user_not_found以外（サービス障害・タイムアウト・レート制限・ネットワーク障害等）は
            // 整合性の問題と断定せず、確認処理自体の失敗として扱う
            authCheckFailed = true
            console.error('[create-patient-user] Authユーザー確認処理に失敗しました')
          }
        } else if (existingAuthUser?.user?.email) {
          authUserMatch = existingAuthUser.user.email.toLowerCase() === email
        }
        // else: エラーはないがuserが存在しない → 構造的に不存在と判定（authUserMatchはfalseのまま）
      }

      if (basicMatch && authUserMatch) {
        return new Response(JSON.stringify({
          success: true,
          already_exists: true,
          login_id: customerNumber,
        }), { headers: jsonHeaders() })
      }

      if (authCheckFailed) {
        return new Response(JSON.stringify({ error: 'アカウント情報の確認中にエラーが発生しました' }),
          { status: 500, headers: jsonHeaders() })
      }

      // 整合性が確認できない場合（Authユーザー不存在・各項目の不一致）は、
      // 自動修復・付け替えをせず安全に停止する
      console.error('[create-patient-user] 既存プロフィールとAuthユーザーの整合性が確認できませんでした')
      return new Response(JSON.stringify({ error: INCONSISTENT_MESSAGE }),
        { status: 409, headers: jsonHeaders() })
    }

    // 1. Auth ユーザー作成
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    })
    if (authErr) {
      const authErrDetails = authErr as { status?: number; code?: string; message?: string }
      // 判定の優先順位：1. code  2. HTTP status  3. message（最後の補助判定）
      const looksLikeDuplicate =
        authErrDetails.code === 'email_exists' ||
        authErrDetails.status === 422 ||
        /already.*(registered|exists)/i.test(authErrDetails.message ?? '')

      console.error('[create-patient-user] Authユーザー作成失敗:', authErrDetails.code ?? authErrDetails.status ?? 'unknown')

      if (looksLikeDuplicate) {
        // 同じメール（＝顧客番号）のAuthユーザーが既に存在するが、この client_id の
        // profile はない状態（他顧客への付け替えの可能性を含む）。自動修復はせず安全に停止する。
        return new Response(JSON.stringify({ error: CONFLICT_MESSAGE }),
          { status: 409, headers: jsonHeaders() })
      }
      // 重複と断定できないAuth作成エラーは、入力不備ではなくサーバー側の予期しない障害として扱う
      return new Response(JSON.stringify({ error: 'アカウント作成中にエラーが発生しました' }),
        { status: 500, headers: jsonHeaders() })
    }

    // 2. profiles 作成（store_id は clients テーブルから取得した値のみを使用）
    const { error: profileErr } = await admin.from('profiles').insert({
      id:        authData.user.id,
      role:      'client',
      client_id,
      store_id:  client.store_id,
    })
    if (profileErr) {
      // ロールバック対象は、今回このリクエストで作成した Auth ユーザーIDだけ
      const { error: rollbackErr } = await admin.auth.admin.deleteUser(authData.user.id)
      if (rollbackErr) {
        console.error('[create-patient-user] ロールバック(Authユーザー削除)に失敗しました')
      }
      console.error('[create-patient-user] profiles作成失敗:', profileErr.message)
      return new Response(JSON.stringify({ error: 'アカウント作成中にエラーが発生しました' }),
        { status: 500, headers: jsonHeaders() })
    }

    return new Response(JSON.stringify({
      success: true,
      login_id: customerNumber,
      password,
    }), { headers: jsonHeaders() })

  } catch (e) {
    console.error('[create-patient-user] unexpected error:', e instanceof Error ? e.message : String(e))
    return new Response(JSON.stringify({ error: 'アカウント作成中にエラーが発生しました' }),
      { status: 500, headers: jsonHeaders() })
  }
})
