// Supabase/PostgREST はデフォルトで1回のクエリにつき最大1000件までしか返さない
// （それ以上は何のエラーも出さずに黙って切り捨てられる）。
// 顧客数・記録数が増えるにつれて件数が1000件を超えると、
// 「日によって別の顧客の記録が一覧から消える」といった再現性の低い不具合の原因になる。
// このヘルパーは、指定したクエリを .range() でページ送りしながら繰り返し呼び出し、
// 全件を確実に取得する。

const PAGE_SIZE = 1000

/**
 * @param {(from: number, to: number) => PromiseLike<{data: any[]|null, error: any}>} buildQuery
 *   from/to（0始まり・両端含む）を受け取り、そのページ分の Supabase クエリを返す関数。
 *   呼び出し側で対象テーブル・select・filterを設定し、必ず一意になる列を含む
 *   決定的な .order() を指定すること（同着順が不定だとページ境界で行の欠落・重複が起きる）。
 * @returns {Promise<{data: any[], error: any}>}
 *   途中でエラーが発生した場合、それまでに取得できた分を data に、エラーを error に入れて返す。
 */
export async function fetchAllPages(buildQuery) {
  const all = []
  let from = 0
  while (true) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await buildQuery(from, to)
    if (error) {
      return { data: all, error }
    }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break // 満杯未満 = 最終ページ
    from += PAGE_SIZE
  }
  return { data: all, error: null }
}
