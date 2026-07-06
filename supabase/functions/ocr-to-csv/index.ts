import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// supabase.functions.invoke は非 2xx を error 扱いするため
// エラーも含めて常に HTTP 200 で返し、body の { error } で判定する
function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

const SYSTEM_PROMPT = `You are a precise data extraction assistant for a Japanese weight management app.

The user will send you a screenshot of a weight management table called "表1" (体調・生活記録 / Health & Lifestyle Records).
The table layout is: rows = health items, columns = calendar dates.

Extract data from these rows ONLY (ignore graphs, 表2, scores, comments, and photos):
- 朝体重 (morning weight in kg) → morning_weight
- 夜体重 (evening weight in kg) → night_weight
- 外食 (eating out) → eating_out: use letters M=morning/L=lunch/D=dinner, combinations like "LD" are valid, blank=""
- 生理 (menstruation) → period_day: if ○/〇/● mark present output "true", blank=""
- 排便 (bowel movement) → bowel_movement: if ○/〇/● mark present output "true", blank=""
- 水分量 (water intake in liters) → water_liters: e.g. "1.5", blank=""
- トイレ (toilet count) → toilet_count: number as string, blank=""
- 睡眠 (sleep hours) → sleep_hours: number as string, blank=""

Return ONLY a valid JSON array — no explanation, no markdown, no code block:
[{"date":"2025-11-07","morning_weight":"73.9","night_weight":"74.3","eating_out":"L","period_day":"true","bowel_movement":"true","water_liters":"1.0","toilet_count":"5","sleep_hours":"7"}]

Rules:
- date must be YYYY-MM-DD (infer the year from context such as page title or graph labels)
- Use "" for blank or unreadable cells
- Skip columns that are entirely empty (future dates, etc.)
- Do not invent data — use "" when unsure`

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    // ── APIキー確認 ──────────────────────────────────────────
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return ok({
        error: 'ANTHROPIC_API_KEY がSupabaseのシークレットに設定されていません。\n' +
               'Supabase Dashboard → Edge Functions → Secrets に\n' +
               'ANTHROPIC_API_KEY を追加してください。',
      })
    }

    // ── リクエスト解析 ───────────────────────────────────────
    let images: string[]
    try {
      const body = await req.json()
      images = body?.images
    } catch {
      return ok({ error: 'リクエストの解析に失敗しました（JSON形式が不正）' })
    }

    if (!Array.isArray(images) || images.length === 0) {
      return ok({ error: '画像が指定されていません' })
    }

    // ── 各画像を Claude Haiku で OCR ─────────────────────────
    const allRows: Record<string, string>[] = []
    const imageErrors: string[] = []

    for (let idx = 0; idx < images.length; idx++) {
      const dataUrl = images[idx]
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) {
        imageErrors.push(`画像${idx + 1}: データURL形式が不正`)
        continue
      }
      const [, mediaType, base64Data] = match

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
              { type: 'text', text: 'Extract table data from this screenshot. Return only the JSON array.' },
            ],
          }],
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        console.error(`Anthropic API error (image ${idx + 1}):`, res.status, errText)

        // APIキー認証エラーの場合は即座に返す
        if (res.status === 401) {
          return ok({
            error: 'Anthropic APIキーが無効です（401 Unauthorized）。\n' +
                   'Supabase Secrets に正しい ANTHROPIC_API_KEY が設定されているか確認してください。',
          })
        }
        if (res.status === 429) {
          return ok({ error: 'Anthropic APIのレート制限に達しました。少し待ってから再試行してください。' })
        }
        imageErrors.push(`画像${idx + 1}: Anthropic API エラー (${res.status})`)
        continue
      }

      const json = await res.json()
      const text: string = json.content?.[0]?.text ?? ''

      // JSON配列を抽出（余分なテキストがある場合も対応）
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        console.warn(`画像${idx + 1}: JSONが見つかりません。応答:`, text.slice(0, 300))
        imageErrors.push(`画像${idx + 1}: 表データを検出できませんでした`)
        continue
      }

      try {
        const rows = JSON.parse(jsonMatch[0]) as Record<string, string>[]
        console.log(`画像${idx + 1}: ${rows.length}行を取得`)
        allRows.push(...rows)
      } catch (e) {
        console.error(`画像${idx + 1}: JSON解析失敗:`, e)
        imageErrors.push(`画像${idx + 1}: データ解析に失敗しました`)
      }
    }

    // ── 重複排除（後から読んだ方を優先）───────────────────────
    const byDate = new Map<string, Record<string, string>>()
    for (const row of allRows) {
      if (row.date && /^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
        byDate.set(row.date, row)
      }
    }
    const deduped = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))

    if (deduped.length === 0 && imageErrors.length > 0) {
      return ok({
        error: '全ての画像でデータ取得に失敗しました:\n' + imageErrors.join('\n'),
      })
    }

    return ok({
      rows: deduped,
      total: deduped.length,
      warnings: imageErrors.length > 0 ? imageErrors : undefined,
    })

  } catch (err) {
    console.error('ocr-to-csv unexpected error:', err)
    return ok({ error: `予期しないエラーが発生しました: ${String(err)}` })
  }
})
