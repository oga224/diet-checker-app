// Supabase Edge Function: 患者パスワードを誕生日に初期化
// アカウントが存在しない場合は自動作成してパスワード設定する
// デプロイ: supabase functions deploy reset-patient-password
//
// 呼び出し元は、対象顧客と同一店舗の admin、または is_super_admin の管理者に限定する。
// 認証・店舗権限チェックは supabase/functions/_shared/auth.ts の requireAdmin が行う。
import { corsHeaders, jsonHeaders } from '../_shared/cors.ts'
import { requireAdmin } from '../_shared/auth.ts'

// client_id は clients.id（uuid）を想定。厳密なUUID形式チェックは既存データとの
// 互換性を優先して行わないが、明らかに不正な巨大文字列だけは早期に弾く。
const MAX_CLIENT_ID_LENGTH = 128

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: '許可されていないメソッドです' }), {
      status: 405,
      headers: { ...jsonHeaders(), 'Allow': 'POST, OPTIONS' },
    })
  }

  // ── リクエストbodyを安全に解析 ──────────────────────────────
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

    // 顧客情報（birthdate・customer_number）を取得
    // store_id は requireAdmin 内で既に検証済みのため、ここでは再取得しない
    const { data: client, error: clientErr } = await admin
      .from('clients')
      .select('birthdate, customer_number')
      .eq('id', client_id)
      .single()

    if (clientErr || !client?.birthdate) {
      if (clientErr) console.error('[reset-patient-password] clients取得エラー:', clientErr.message)
      return new Response(JSON.stringify({ error: '生年月日が登録されていません' }),
        { status: 400, headers: jsonHeaders() })
    }
    if (!client?.customer_number) {
      return new Response(JSON.stringify({ error: '顧客番号が登録されていません' }),
        { status: 400, headers: jsonHeaders() })
    }

    const password = client.birthdate.replace(/-/g, '') // YYYY-MM-DD → YYYYMMDD

    // プロフィール（auth uid）を確認
    const { data: profile } = await admin
      .from('profiles')
      .select('id')
      .eq('client_id', client_id)
      .eq('role', 'client')
      .maybeSingle()

    // ── アカウントなし → 新規作成してパスワード設定 ──────────
    if (!profile?.id) {
      const email = `${client.customer_number.toLowerCase()}@patient.internal`

      const { data: authData, error: authErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      })
      if (authErr) {
        console.error('[reset-patient-password] Authユーザー作成失敗:', authErr.message)
        return new Response(JSON.stringify({ error: 'アカウント作成に失敗しました' }),
          { status: 400, headers: jsonHeaders() })
      }

      const { error: profileErr } = await admin.from('profiles').insert({
        id:        authData.user.id,
        role:      'client',
        client_id,
        store_id:  auth.targetClient?.store_id ?? null,
      })
      if (profileErr) {
        await admin.auth.admin.deleteUser(authData.user.id) // ロールバック
        console.error('[reset-patient-password] profiles作成失敗:', profileErr.message)
        return new Response(JSON.stringify({ error: 'プロフィール作成に失敗しました' }),
          { status: 400, headers: jsonHeaders() })
      }

      return new Response(JSON.stringify({ success: true, password, created: true }),
        { headers: jsonHeaders() })
    }

    // ── アカウントあり → パスワード更新 ──────────────────────
    const { error: updateErr } = await admin.auth.admin.updateUserById(profile.id, { password })
    if (updateErr) {
      console.error('[reset-patient-password] パスワード更新失敗:', updateErr.message)
      return new Response(JSON.stringify({ error: 'パスワード更新に失敗しました' }),
        { status: 400, headers: jsonHeaders() })
    }

    // password_changed フラグをリセット（初回案内を再表示）
    await admin.from('profiles').update({ password_changed: false }).eq('id', profile.id)

    return new Response(JSON.stringify({ success: true, password, created: false }),
      { headers: jsonHeaders() })

  } catch (e) {
    console.error('[reset-patient-password] unexpected error:', e instanceof Error ? e.message : String(e))
    return new Response(JSON.stringify({ error: '処理中にエラーが発生しました' }),
      { status: 500, headers: jsonHeaders() })
  }
})
