/** 顧客番号 → 内部用メールアドレス（Supabase Authはメール形式必須） */
export function customerNumberToEmail(customerNumber) {
  return `${customerNumber.trim().toLowerCase()}@patient.internal`
}

/** YYYY-MM-DD → YYYYMMDD（初期パスワード） */
export function birthdateToPassword(birthdate) {
  return birthdate.replace(/-/g, '')
}

/** 入力値がメールアドレス形式かどうか */
export function looksLikeEmail(val) {
  return val.includes('@')
}
