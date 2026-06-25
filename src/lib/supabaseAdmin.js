import { createClient } from '@supabase/supabase-js'

/**
 * Supabase Admin クライアント（Service Role Key 使用）
 *
 * ⚠️ このクライアントは RLS を完全にバイパスします。
 *    管理者専用操作（Auth User の作成・削除・profiles の書き込み）にのみ使用してください。
 *
 * Vercel 環境変数に VITE_SUPABASE_SERVICE_ROLE_KEY を設定してください。
 * Supabase ダッシュボード → Project Settings → API → service_role (secret) からコピー。
 */
const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const serviceRoleKey  = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY

if (!serviceRoleKey) {
  console.warn('[supabaseAdmin] VITE_SUPABASE_SERVICE_ROLE_KEY が未設定です。お客さんの新規登録・削除が使えません。')
}

export const supabaseAdmin = serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession:   false,
      },
    })
  : null
