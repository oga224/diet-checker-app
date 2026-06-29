/**
 * 体重の入力バリデーション（小数点以下1桁まで）
 * OK: 65, 65.5, 100.0
 * NG: 65.55, 65.123
 */

/** 体重の正規表現パターン */
export const WEIGHT_PATTERN = /^\d{1,3}(\.\d)?$/

/** 体重の値が有効かどうかを判定 */
export function isValidWeight(val) {
  if (val === '' || val == null) return true  // 未入力は OK
  return WEIGHT_PATTERN.test(String(val).trim())
}

/**
 * onChange で呼ぶフィルタ関数
 * 小数点以下2桁目以降の入力を拒否する
 * @returns フィルタ後の文字列。拒否する場合は null を返す
 */
export function filterWeightInput(val) {
  if (val === '') return val
  const dotIdx = val.indexOf('.')
  if (dotIdx !== -1 && val.length - dotIdx > 2) return null  // 2桁目以降を拒否
  return val
}

/** エラーメッセージ */
export const WEIGHT_ERROR_MSG = '体重は小数点以下1桁まで入力してください（例：65.5）'
