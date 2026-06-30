// Supabase Edge Function: 顧客番号＋誕生日で患者ログインアカウントを作成
// デプロイ: supabase functions deploy create-patient-user
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
    const { client_id, customer_number, birthdate, store_id } = await req.json()
    if (!client_id || !customer_number || !birthdate) {
      return new Response(JSON.stringify({ error: 'client_id, customer_number, birthdate は必須です' }),
        { status: 400, headers: corsHeaders() })
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    const email    = `${customer_number.toLowerCase()}@patient.internal`
    const password = birthdate.replace(/-/g, '') // YYYY-MM-DD → YYYYMMDD

    // 1. Auth ユーザー作成
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    })
    if (authErr) {
      return new Response(JSON.stringify({ error: `Authユーザー作成失敗: ${authErr.message}` }),
        { status: 400, headers: corsHeaders() })
    }

    // 2. profiles 作成
    const { error: profileErr } = await admin.from('profiles').insert({
      id: authData.user.id,
      role: 'client',
      client_id,
      store_id: store_id ?? null,
    })
    if (profileErr) {
      await admin.auth.admin.deleteUser(authData.user.id) // ロールバック
      return new Response(JSON.stringify({ error: `プロフィール作成失敗: ${profileErr.message}` }),
        { status: 400, headers: corsHeaders() })
    }

    return new Response(JSON.stringify({
      success: true,
      login_id: customer_number,
      password,
    }), { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders() })
  }
})
