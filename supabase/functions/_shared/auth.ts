// Edge Functions 共通の管理者認証・店舗権限チェック。
//
// 呼び出し元（各 index.ts）は、service role による変更処理を行う前に
// 必ず requireAdmin() を呼び、ok === true を確認してから処理を進めること。
//
// 権限仕様（本番 profiles の実態に合わせて確定）：
//   1. role が 'admin' の者だけを許可する（'client' は拒否、'staff' は現状未使用のため拒否）
//   2. is_super_admin === true の管理者は店舗を問わず操作可能
//   3. 上記以外の通常 admin は、profiles.store_id と対象 clients.store_id が
//      一致する場合のみ許可する
//   4. profiles.store_id が未設定（null）かつ is_super_admin !== true の場合は拒否する
//   5. リクエストbodyの store_id は一切信頼しない。常に DB から取得した値のみを使う
//   6. 「顧客が存在しない」場合と「別店舗で権限がない」場合は、同じ403・同じ一般的な
//      メッセージを返し、client_id の存在有無を外部から推測されないようにする
//
// 秘密情報（JWTの中身・パスワード・APIキー等）はログへ出力しない。

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const GENERIC_FORBIDDEN = 'この操作を実行する権限がありません'

export interface AdminProfile {
  id: string
  role: string
  store_id: string | null
  is_super_admin: boolean
}

export interface TargetClient {
  id: string
  store_id: string | null
}

export interface AdminAuthSuccess {
  ok: true
  user: { id: string }
  profile: AdminProfile
  /** 以降のDB操作は必ずこのクライアント（service role）経由で行う */
  serviceClient: SupabaseClient
  /** targetClientId を指定した場合のみ設定される */
  targetClient: TargetClient | null
}

export interface AdminAuthFailure {
  ok: false
  status: number
  error: string
}

export type AdminAuthResult = AdminAuthSuccess | AdminAuthFailure

/**
 * リクエストの Authorization ヘッダーから JWT を検証し、
 * 「同一店舗の admin」または「is_super_admin の管理者」であることを確認する。
 *
 * @param req             Edge Function が受け取った Request
 * @param targetClientId  権限確認の対象となる clients.id（省略時は role 確認のみ行う）
 */
export async function requireAdmin(
  req: Request,
  targetClientId?: string,
): Promise<AdminAuthResult> {
  // 環境変数が不足している場合はサーバー設定の問題として500にする（値は返さない）
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[requireAdmin] 必要な環境変数が設定されていません')
    return { ok: false, status: 500, error: 'サーバー設定エラーが発生しました' }
  }

  // 1〜2. Authorizationヘッダーを取得（Headers.get は大文字小文字を区別しない）
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: '認証が必要です' }
  }
  const jwt = authHeader.slice('Bearer '.length).trim()
  if (!jwt) {
    return { ok: false, status: 401, error: '認証が必要です' }
  }

  // 3〜5. 通常クライアント（anon key）で JWT を検証する
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data: userData, error: userErr } = await anonClient.auth.getUser(jwt)
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, error: '認証が無効です' }
  }
  const user = { id: userData.user.id }

  // 7. service role クライアント（以降のDB操作は必ずこちらを使う）
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // 8〜9. 検証済み user.id を起点に profiles を取得する（bodyやJWTのclaimは信頼しない）
  const { data: profileRow, error: profileErr } = await serviceClient
    .from('profiles')
    .select('id, role, store_id, is_super_admin')
    .eq('id', user.id)
    .maybeSingle()

  if (profileErr) {
    console.error('[requireAdmin] profiles取得エラー:', profileErr.message)
    return { ok: false, status: 500, error: 'サーバーエラーが発生しました' }
  }
  if (!profileRow) {
    return { ok: false, status: 403, error: GENERIC_FORBIDDEN }
  }

  // 10. role確認：admin以外（client・staff等）は拒否
  if (profileRow.role !== 'admin') {
    return { ok: false, status: 403, error: GENERIC_FORBIDDEN }
  }

  const isSuperAdmin = profileRow.is_super_admin === true

  // 12. is_super_admin=false かつ store_id 未設定の管理者は拒否
  if (!isSuperAdmin && !profileRow.store_id) {
    return { ok: false, status: 403, error: GENERIC_FORBIDDEN }
  }

  const profile: AdminProfile = {
    id: profileRow.id,
    role: profileRow.role,
    store_id: profileRow.store_id,
    is_super_admin: isSuperAdmin,
  }

  // targetClientId が指定されていなければ、ここまでの role 確認だけで許可する
  if (!targetClientId) {
    return { ok: true, user, profile, serviceClient, targetClient: null }
  }

  // 13. 対象顧客の store_id を DB から取得する（リクエストbodyのstore_idは使わない）
  const { data: clientRow, error: clientErr } = await serviceClient
    .from('clients')
    .select('id, store_id')
    .eq('id', targetClientId)
    .maybeSingle()

  if (clientErr) {
    console.error('[requireAdmin] clients取得エラー:', clientErr.message)
    return { ok: false, status: 500, error: 'サーバーエラーが発生しました' }
  }

  // 14. 顧客が存在しない場合も、別店舗で権限がない場合と同じ403・同じメッセージにする
  if (!clientRow) {
    return { ok: false, status: 403, error: GENERIC_FORBIDDEN }
  }

  // 11 / 15. is_super_admin は店舗チェックを省略。通常adminは店舗一致を必須にする
  if (!isSuperAdmin && clientRow.store_id !== profile.store_id) {
    return { ok: false, status: 403, error: GENERIC_FORBIDDEN }
  }

  return {
    ok: true,
    user,
    profile,
    serviceClient,
    targetClient: { id: clientRow.id, store_id: clientRow.store_id },
  }
}
