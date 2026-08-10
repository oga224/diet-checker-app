// 他店舗の顧客を「個人識別情報なし」で閲覧するための唯一の窓口。
// Phase 5B-1Bで追加したSECURITY DEFINER RPC
// （admin_list_other_store_clients / admin_get_other_store_client /
//   admin_get_other_store_weight_logs / admin_get_other_store_meal_logs）
// だけを呼び出す。他店舗を表示する経路では、この4関数以外から
// clients / weight_logs / meal_logs を直接取得してはならない。

import { format } from 'date-fns'
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

/**
 * 他店舗一覧RPCの1行から、一覧画面が自店舗と共通のロジックで扱える
 * 体重サマリー・入力状況情報を組み立てる。氏名・かな等は一切参照・生成しない。
 * 食事写真はRPCが返す「有無」のbooleanを、evaluateLogが真偽値だけを見る
 * URLフィールドの代用値として使う（実URLはここでも扱わない）。
 */
export function buildOtherStoreWeightInfo(row) {
  const lastDate = row.last_log_date ?? null
  const latestLog = lastDate ? {
    date: lastDate,
    morning_kg:     row.last_log_morning_kg,
    evening_kg:     row.last_log_evening_kg,
    water_ml:       row.last_log_water_ml,
    toilet_count:   row.last_log_toilet_count,
    sleep_hours:    row.last_log_sleep_hours,
    bowel_movement: row.last_log_bowel_movement,
    ate_breakfast:  row.last_log_ate_breakfast,
    ate_lunch:      row.last_log_ate_lunch,
    ate_dinner:     row.last_log_ate_dinner,
    ate_snack:      row.last_log_ate_snack,
  } : null
  const isToday = lastDate === format(new Date(), 'yyyy-MM-dd')
  return {
    firstKg:   row.start_weight ?? null,
    latestKg:  row.latest_weight ?? null,
    lastDate,
    latestLog,
    todayLog:  isToday ? latestLog : null,
    todayMeal: isToday ? {
      breakfast_photo_url: row.last_log_breakfast_has_photo ? true : null,
      lunch_photo_url:     row.last_log_lunch_has_photo ? true : null,
      dinner_photo_url:    row.last_log_dinner_has_photo ? true : null,
    } : null,
  }
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
