// Supabase Edge Function: 患者パスワードを誕生日に初期化
// アカウントが存在しない場合は自動作成してパスワード設定する
// デプロイ: supabase functions deploy reset-patient-password
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  try {
    const { client_id } = await req.json()
    if (!client_id) {
      return new Response(JSON.stringify({ error: 'client_id は必須です' }),
        { status: 400, headers: corsHeaders() })
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    // 顧客情報（birthdate・customer_number・store_id）を取得
    const { data: client, error: clientErr } = await admin
      .from('clients')
      .select('birthdate, customer_number, store_id')
      .eq('id', client_id)
      .single()

    if (clientErr || !client?.birthdate) {
      return new Response(JSON.stringify({ error: '生年月日が登録されていません' }),
        { status: 400, headers: corsHeaders() })
    }
    if (!client?.customer_number) {
      return new Response(JSON.stringify({ error: '顧客番号が登録されていません' }),
        { status: 400, headers: corsHeaders() })
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
        return new Response(JSON.stringify({ error: `アカウント作成失敗: ${authErr.message}` }),
          { status: 400, headers: corsHeaders() })
      }

      const { error: profileErr } = await admin.from('profiles').insert({
        id:        authData.user.id,
        role:      'client',
        client_id,
        store_id:  client.store_id ?? null,
      })
      if (profileErr) {
        await admin.auth.admin.deleteUser(authData.user.id) // ロールバック
        return new Response(JSON.stringify({ error: `プロフィール作成失敗: ${profileErr.message}` }),
          { status: 400, headers: corsHeaders() })
      }

      return new Response(JSON.stringify({ success: true, password, created: true }),
        { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
    }

    // ── アカウントあり → パスワード更新 ──────────────────────
    const { error: updateErr } = await admin.auth.admin.updateUserById(profile.id, { password })
    if (updateErr) {
      return new Response(JSON.stringify({ error: `パスワード更新失敗: ${updateErr.message}` }),
        { status: 400, headers: corsHeaders() })
    }

    // password_changed フラグをリセット（初回案内を再表示）
    await admin.from('profiles').update({ password_changed: false }).eq('id', profile.id)

    return new Response(JSON.stringify({ success: true, password, created: false }),
      { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders() })
  }
})
