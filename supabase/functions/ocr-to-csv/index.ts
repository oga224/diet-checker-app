import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SYSTEM_PROMPT = `You are a precise data extraction assistant for a Japanese weight management app.

The user will send you a screenshot of a weight management table called "表1" (体調・生活記録 / Health & Lifestyle Records).
The table layout is: rows = health items, columns = calendar dates.

Extract data from these rows ONLY (ignore graphs, 表2, scores, comments, and photos):
- 朝体重 (morning weight in kg) → morning_weight
- 夜体重 (evening weight in kg) → night_weight
- 外食 (eating out) → eating_out: use letters M=morning/L=lunch/D=dinner, combinations like "LD" are valid, blank=""
- 生理 (menstruation) → period_day: ○=true, blank=""
- 排便 (bowel movement) → bowel_movement: ○=true, blank=""
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
    const { images } = await req.json() as { images: string[] }

    if (!Array.isArray(images) || images.length === 0) {
      return new Response(
        JSON.stringify({ error: '画像が指定されていません' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY がSupabaseのシークレットに設定されていません' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    const allRows: Record<string, string>[] = []

    for (const dataUrl of images) {
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) { console.warn('Invalid data URL, skipping'); continue }
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
        console.error('Anthropic API error:', res.status, errText)
        continue
      }

      const json = await res.json()
      const text: string = json.content?.[0]?.text ?? ''

      // JSON配列を抽出（余分なテキストがある場合も対応）
      const jsonMatch = text.match(/\[[\s\S]*?\]/)
      if (!jsonMatch) { console.warn('No JSON array in response:', text.slice(0, 300)); continue }

      try {
        const rows = JSON.parse(jsonMatch[0]) as Record<string, string>[]
        allRows.push(...rows)
      } catch (e) {
        console.error('JSON parse failed:', e, jsonMatch[0].slice(0, 200))
      }
    }

    // 複数画像で同じ日付がある場合は後から読み込んだ方を優先
    const byDate = new Map<string, Record<string, string>>()
    for (const row of allRows) {
      if (row.date && /^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
        byDate.set(row.date, row)
      }
    }
    const deduped = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))

    return new Response(
      JSON.stringify({ rows: deduped, total: deduped.length }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('ocr-to-csv error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
})
