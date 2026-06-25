/**
 * 1日の記録を100点満点で採点する（数値基準ルールベース）。
 *
 * 配点:
 *   朝→夜体重増加  25点  +0.5kg以内ならOK
 *   排便           15点  trueならOK
 *   水分量         20点  1500ml以上ならOK
 *   トイレ回数     15点  10回以上ならOK
 *   睡眠時間       15点  5.5時間以上ならOK
 *   写真・コメント  10点  どちらかあればOK
 *                 ─────
 *                 100点
 *
 * @param {object}      log     - weight_logs の1行
 * @param {number|null} _prevKg - 未使用（後方互換のため残す）
 * @param {object|null} mealLog - meal_logs の1行（写真URL確認用）
 * @returns {{ score, metrics, advice }}
 */
export function evaluateLog(log, _prevKg = null, mealLog = null) {
  let score = 0

  // ── 1. 朝→夜 体重増加（25点）──────────────────────
  let weightDiff = null
  let weightOk   = null
  if (log.morning_kg != null && log.evening_kg != null) {
    weightDiff = +(log.evening_kg - log.morning_kg).toFixed(2)
    weightOk   = weightDiff <= 0.5
    if (weightOk) score += 25
  }

  // ── 2. 排便（15点）──────────────────────────────────
  const bowelOk = log.bowel_movement === true  ? true
                : log.bowel_movement === false ? false
                : null
  if (bowelOk === true) score += 15

  // ── 3. 水分量（20点）────────────────────────────────
  const waterOk = log.water_ml != null ? log.water_ml >= 1500 : null
  if (waterOk === true) score += 20

  // ── 4. トイレ回数（15点）────────────────────────────
  const toiletOk = log.toilet_count != null ? log.toilet_count >= 10 : null
  if (toiletOk === true) score += 15

  // ── 5. 睡眠時間（15点）──────────────────────────────
  const sleepOk = log.sleep_hours != null ? log.sleep_hours >= 5.5 : null
  if (sleepOk === true) score += 15

  // ── 6. 写真・コメント（10点）────────────────────────
  const hasPhoto = mealLog
    ? [mealLog.breakfast_photo_url, mealLog.lunch_photo_url,
       mealLog.dinner_photo_url,    mealLog.snack_photo_url].some(Boolean)
    : false
  const hasComment = !!log.comment
  const effortOk   = hasPhoto || hasComment
  if (effortOk) score += 10

  score = Math.min(Math.round(score), 100)

  // ── 表示用メトリクス ────────────────────────────────
  const metrics = [
    {
      key:       'weight_change',
      label:     '朝→夜 体重変化',
      value:     weightDiff != null
                   ? `${weightDiff >= 0 ? '+' : ''}${weightDiff.toFixed(1)}kg`
                   : '—',
      ok:        weightOk,
      threshold: '+0.5kg以内',
      points:    25,
    },
    {
      key:       'bowel',
      label:     '排便',
      value:     log.bowel_movement === true ? 'あり'
               : log.bowel_movement === false ? 'なし'
               : '—',
      ok:        bowelOk,
      threshold: 'あり',
      points:    15,
    },
    {
      key:       'water',
      label:     '水分量',
      value:     log.water_ml != null ? `${(log.water_ml / 1000).toFixed(1)}L` : '—',
      ok:        waterOk,
      threshold: '1.5L以上',
      points:    20,
    },
    {
      key:       'toilet',
      label:     'トイレ回数',
      value:     log.toilet_count != null ? `${log.toilet_count}回` : '—',
      ok:        toiletOk,
      threshold: '10回以上',
      points:    15,
    },
    {
      key:       'sleep',
      label:     '睡眠時間',
      value:     log.sleep_hours != null ? `${log.sleep_hours}時間` : '—',
      ok:        sleepOk,
      threshold: '5.5時間以上',
      points:    15,
    },
    {
      key:       'effort',
      label:     '写真・コメント',
      value:     hasPhoto && hasComment ? '写真＋コメント'
               : hasPhoto               ? '写真あり'
               : hasComment             ? 'コメントあり'
               : '未入力',
      ok:        effortOk ? true : (hasPhoto === false && hasComment === false ? false : null),
      threshold: 'どちらかあれば',
      points:    10,
    },
  ]

  // ── アドバイス ──────────────────────────────────────
  const ngItems = metrics.filter((m) => m.ok === false)
  let advice
  if (score === 100) {
    advice = '全ての項目をクリアしました！この調子を続けましょう。'
  } else if (ngItems.length > 0) {
    const labels = ngItems.map((m) => m.label).join('・')
    advice = `${labels}を意識してみましょう。`
  } else {
    advice = '記録を続けることが大切です。今日も頑張りました。'
  }

  return { score, metrics, advice }
}

/** スコアに対応する色クラス */
export function scoreColor(score) {
  if (score >= 85) return { text: 'text-green-600',  bg: 'bg-green-50',  border: 'border-green-200' }
  if (score >= 70) return { text: 'text-blue-600',   bg: 'bg-blue-50',   border: 'border-blue-200'  }
  if (score >= 55) return { text: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200'}
  return               { text: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200'}
}

/** スコアに対応するラベル */
export function scoreLabel(score) {
  if (score >= 90) return '最高'
  if (score >= 80) return '良好'
  if (score >= 70) return 'まずまず'
  if (score >= 55) return '要改善'
  return '要注意'
}
