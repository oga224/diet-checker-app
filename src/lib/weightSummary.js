// 開始体重・最新体重・体重差の算出ロジック（お客さん一覧・顧客詳細で共通利用）。
// 同じ weight_logs を渡した場合、どちらの画面でも必ず同じ結果になるようにするため、
// この計算をここに集約する。

function isValidWeight(v) {
  if (v == null) return false // null / undefined のみ弾く（0kgは有効な値として扱う）
  if (typeof v === 'string' && v.trim() === '') return false // 空文字を弾く（Number('')は0になるため個別チェックが必要）
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) // NaN・数値変換不可を弾く
}

/**
 * weight_logs の配列（順不同・同一顧客分を想定）から、開始体重・最新体重・体重差を算出する。
 *
 * ・開始体重＝日付が最も古い、有効な morning_kg を持つ記録
 * ・最新体重＝日付が最も新しい、有効な morning_kg を持つ記録
 * ・体重差　＝最新体重−開始体重
 * ・同じ日付に複数レコードがある場合は id の昇順で並べ、常に同じ結果になるようにする
 *
 * @param {Array<{date: string, morning_kg: number|string|null, id?: string|number}>} logs
 * @returns {{ startWeight: number|null, latestWeight: number|null, difference: number|null }}
 */
export function computeWeightSummary(logs) {
  const valid = (Array.isArray(logs) ? logs : [])
    .filter((l) => l && typeof l.date === 'string' && l.date && isValidWeight(l.morning_kg))
    .map((l) => ({
      date: l.date,
      id: l.id,
      weight: typeof l.morning_kg === 'number' ? l.morning_kg : Number(l.morning_kg),
    }))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1
      const aId = String(a.id ?? '')
      const bId = String(b.id ?? '')
      return aId < bId ? -1 : aId > bId ? 1 : 0
    })

  if (valid.length === 0) {
    return { startWeight: null, latestWeight: null, difference: null }
  }

  const startWeight  = valid[0].weight
  const latestWeight = valid[valid.length - 1].weight
  const difference   = +(latestWeight - startWeight).toFixed(1)
  return { startWeight, latestWeight, difference }
}

/**
 * logs（順不同）のうち、日付が最も新しい行を1件返す（morning_kgの有無は問わない）。
 * 「最終入力日からの経過日数」バッジなど、体重の有無に関わらず
 * 「最後に何か記録した日」を知りたい用途向け。
 * @param {Array<{date: string}>} logs
 */
export function findLatestLog(logs) {
  let latest = null
  for (const l of Array.isArray(logs) ? logs : []) {
    if (!l || typeof l.date !== 'string' || !l.date) continue
    if (!latest || l.date > latest.date) latest = l
  }
  return latest
}
