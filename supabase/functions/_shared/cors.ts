// Edge Functions 共通の CORS ヘッダー。
//
// 現時点では既存機能への影響を避けるため、Access-Control-Allow-Origin は
// 既存の実装どおり '*'（全オリジン許可）を維持する。
// ドメイン制限は別途検討する。

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

/** JSON本文を返すレスポンス用に、CORSヘッダーへ Content-Type: application/json を加えたもの */
export function jsonHeaders(): Record<string, string> {
  return {
    ...corsHeaders(),
    'Content-Type': 'application/json',
  }
}
