// 他店舗の顧客を「個人識別情報なし」で閲覧するための唯一の窓口。
// Phase 5B-1Bで追加したSECURITY DEFINER RPC
// （admin_list_other_store_clients / admin_get_other_store_client /
//   admin_get_other_store_weight_logs / admin_get_other_store_meal_logs）
// だけを呼び出す。他店舗を表示する経路では、この4関数以外から
// clients / weight_logs / meal_logs を直接取得してはならない。

import { supabase } from './supabase'
import { fetchAllPages } from './fetchAllPages'

// RPCは日付列を log_date で返す。既存コンポーネントが期待する date に、
// 取得直後にここで正規化する（コンポーネント側には持ち込まない）。
function normalizeLogDate(row) {
  const { log_date, ...rest } = row
  return { ...rest, date: log_date }
}

/** 他店舗の顧客一覧（匿名化済み）。一覧画面用。 */
export async function fetchOtherStoreClients(storeId) {
  return fetchAllPages((from, to) =>
    supabase.rpc('admin_list_other_store_clients', { p_store_id: storeId }).range(from, to)
  )
}

/** 他店舗の顧客1件（匿名化済み）。詳細画面用。 */
export async function fetchOtherStoreClient(clientId) {
  return supabase.rpc('admin_get_other_store_client', { p_client_id: clientId }).single()
}

/** 他店舗の顧客の体重・生活記録全件（匿名化済み・has_commentのみ、本文なし）。 */
export async function fetchOtherStoreWeightLogs(clientId) {
  const { data, error } = await fetchAllPages((from, to) =>
    supabase.rpc('admin_get_other_store_weight_logs', { p_client_id: clientId }).range(from, to)
  )
  return { data: (data ?? []).map(normalizeLogDate), error }
}

/** 他店舗の顧客の食事写真参照情報全件（匿名化済み）。 */
export async function fetchOtherStoreMealLogs(clientId) {
  const { data, error } = await fetchAllPages((from, to) =>
    supabase.rpc('admin_get_other_store_meal_logs', { p_client_id: clientId }).range(from, to)
  )
  return { data: (data ?? []).map(normalizeLogDate), error }
}

/**
 * 他店舗顧客の画面表示用ラベル。
 * 一覧の並び順を基にした表示専用の連番（DBには保存しない）。
 * 連番が分からない場合（詳細リロード等）は番号なしの「匿名顧客」を返す。
 */
export function anonClientLabel(index) {
  return index ? `匿名顧客 ${index}` : '匿名顧客'
}
