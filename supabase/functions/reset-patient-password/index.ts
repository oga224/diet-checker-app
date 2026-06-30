// Supabase Edge Function: 患者パスワードを誕生日に初期化
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

    // 顧客の生年月日とプロフィール（auth uid）を取得
    const [{ data: client, error: clientErr }, { data: profile, error: profileErr }] = await Promise.all([
      admin.from('clients').select('birthdate').eq('id', client_id).single(),
      admin.from('profiles').select('id').eq('client_id', client_id).eq('role', 'client').single(),
    ])
    if (clientErr || !client?.birthdate) {
      return new Response(JSON.stringify({ error: '生年月日が登録されていません' }),
        { status: 400, headers: corsHeaders() })
    }
    if (profileErr || !profile?.id) {
      return new Response(JSON.stringify({ error: 'ログインアカウントが見つかりません' }),
        { status: 400, headers: corsHeaders() })
    }

    const password = client.birthdate.replace(/-/g, '')

    const { error: updateErr } = await admin.auth.admin.updateUserById(profile.id, { password })
    if (updateErr) {
      return new Response(JSON.stringify({ error: `パスワード更新失敗: ${updateErr.message}` }),
        { status: 400, headers: corsHeaders() })
    }

    // password_changed フラグをリセット（初回案内を再表示）
    await admin.from('profiles').update({ password_changed: false }).eq('id', profile.id)

    return new Response(JSON.stringify({ success: true, password }),
      { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders() })
  }
})
