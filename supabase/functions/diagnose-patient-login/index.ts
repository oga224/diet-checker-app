// Supabase Edge Function: 患者ログイン診断
// デプロイ: supabase functions deploy diagnose-patient-login
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
    const issues: string[] = []

    // 1. 顧客情報
    const { data: client } = await admin
      .from('clients')
      .select('id, customer_number, birthdate, store_id')
      .eq('id', client_id)
      .single()

    if (!client?.customer_number) issues.push('顧客番号が未設定です')
    if (!client?.birthdate)        issues.push('生年月日が未設定です（初期パスワードに必要）')

    // 2. profiles テーブル確認
    const { data: profile } = await admin
      .from('profiles')
      .select('id, client_id, store_id, password_changed, first_login_at')
      .eq('client_id', client_id)
      .eq('role', 'client')
      .maybeSingle()

    if (!profile) {
      issues.push('profiles にアカウントが存在しません（患者ログインアカウント未発行）')
    } else {
      if (client?.store_id && profile.store_id !== client.store_id) {
        issues.push(`store_id 不一致: profiles=${profile.store_id ?? 'null'}, clients=${client.store_id}`)
      }
    }

    // 3. auth.users 確認（profile が存在する場合のみ）
    let authUser: Record<string, unknown> | null = null
    if (profile?.id) {
      const { data: authData, error: authErr } = await admin.auth.admin.getUserById(profile.id)
      if (authErr || !authData?.user) {
        issues.push(`auth.users にユーザーが存在しません (profile.id: ${profile.id})`)
      } else {
        authUser = {
          id:              authData.user.id,
          email:           authData.user.email,
          created_at:      authData.user.created_at,
          last_sign_in_at: authData.user.last_sign_in_at,
        }
      }
    }

    // 4. ステータス判定
    let status = 'unissued'
    if (profile && authUser) {
      status = issues.length === 0 ? 'loginable' : 'error'
    } else if (profile || authUser) {
      status = 'error'
      issues.push('profiles と auth.users の整合性エラー（片方のみ存在）')
    }

    return new Response(JSON.stringify({
      success: true,
      status,  // 'unissued' | 'loginable' | 'error'
      issues,
      client: client ? {
        id:              client.id,
        customer_number: client.customer_number,
        birthdate:       client.birthdate,
        store_id:        client.store_id,
      } : null,
      profile: profile ? {
        id:               profile.id,
        client_id:        profile.client_id,
        store_id:         profile.store_id,
        password_changed: profile.password_changed,
        first_login_at:   profile.first_login_at,
      } : null,
      auth_user: authUser,
    }), { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders() })
  }
})
