import { format } from 'date-fns'

/**
 * 1日の記録を100点満点で採点する（数値基準ルールベース）。
 *
 * 基本配点:
 *   朝→夜体重変化  20点  +0.5kg以内ならOK（夜体重未入力なら「入力待ち」＝未判定）
 *   水分量         20点  1.5L以上ならOK
 *   トイレ回数     15点  10回以上ならOK
 *   睡眠時間       15点  5.5時間以上ならOK
 *   排便           15点  あり(true)ならOK
 *   食事写真       15点  実際に食べた食事（朝・昼・夕、間食は含まない）のうち
 *                       写真登録できた割合 × 15点（0.5点単位）
 *                 ─────
 *                 100点
 *
 *   間食（ate_snack === true）: 基本点の合計から一律10点減点
 *   最終スコアは0点未満にならない（0点が下限）
 *
 * log.date が「今日」の場合は「入力途中の暫定評価」（isToday: true）として扱う。
 * 呼び出し側（EvaluationCard 等）はこれを見て、最終評価ラベル（要注意 等）を
 * 出さず「入力途中」の表現に切り替える。過去日は最終評価として扱う。
 *
 * @param {object}      log     - weight_logs の1行（.date を含む必要がある）
 * @param {number|null} _prevKg - 未使用（後方互換のため残す）
 * @param {object|null} mealLog - meal_logs の1行（写真URL確認用）
 * @returns {{
 *   score:number, basePoints:number, isToday:boolean, isFinal:boolean,
 *   metrics:object[], snack:{flag:boolean|null, penalty:number},
 *   potential:{current:number, max:number, remaining:number}|null,
 *   advice:{heading:string, items:string[]}
 * }}
 */
export function evaluateLog(log, _prevKg = null, mealLog = null) {
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const isToday  = log?.date === todayStr

  const metrics = []
  let basePoints = 0

  // ── 1. 朝→夜体重変化（20点）───────────────────────────
  let weightDiff    = null
  let weightOk       = null   // true=達成 / false=入力済みだが未達成 / null=未判定（未入力）
  let weightPending  = null   // 'morning' | 'evening' | null
  if (log.morning_kg == null) {
    weightPending = 'morning'
  } else if (log.evening_kg == null) {
    weightPending = 'evening'
  } else {
    weightDiff = +(log.evening_kg - log.morning_kg).toFixed(2)
    weightOk   = weightDiff <= 0.5
  }
  if (weightOk === true) basePoints += 20
  metrics.push({
    key: 'weight_change', label: '朝→夜体重変化', maxPoints: 20,
    points:    weightOk === true ? 20 : 0,
    achieved:  weightOk,
    value:     weightDiff != null ? `${weightDiff >= 0 ? '+' : ''}${weightDiff.toFixed(1)}kg` : null,
    pending:   weightPending,
    threshold: '+0.5kg以内',
  })

  // ── 2. 水分量（20点）──────────────────────────────────
  const waterOk = log.water_ml != null ? log.water_ml >= 1500 : null
  if (waterOk === true) basePoints += 20
  const waterL = log.water_ml != null ? +(log.water_ml / 1000).toFixed(1) : null
  metrics.push({
    key: 'water', label: '水分量', maxPoints: 20,
    points:    waterOk === true ? 20 : 0,
    achieved:  waterOk,
    value:     waterL != null ? `${waterL}L` : null,
    remaining: waterOk === false ? `${Math.max(0, +(1.5 - waterL).toFixed(1))}L` : null,
    threshold: '1.5L以上',
  })

  // ── 3. トイレ回数（15点）──────────────────────────────
  const toiletOk = log.toilet_count != null ? log.toilet_count >= 10 : null
  if (toiletOk === true) basePoints += 15
  metrics.push({
    key: 'toilet', label: 'トイレ回数', maxPoints: 15,
    points:    toiletOk === true ? 15 : 0,
    achieved:  toiletOk,
    value:     log.toilet_count != null ? `${log.toilet_count}回` : null,
    remaining: toiletOk === false ? `${10 - log.toilet_count}回` : null,
    threshold: '10回以上',
  })

  // ── 4. 睡眠時間（15点）────────────────────────────────
  const sleepOk = log.sleep_hours != null ? log.sleep_hours >= 5.5 : null
  if (sleepOk === true) basePoints += 15
  metrics.push({
    key: 'sleep', label: '睡眠時間', maxPoints: 15,
    points:    sleepOk === true ? 15 : 0,
    achieved:  sleepOk,
    value:     log.sleep_hours != null ? `${log.sleep_hours}時間` : null,
    remaining: sleepOk === false ? `${+(5.5 - log.sleep_hours).toFixed(1)}時間` : null,
    threshold: '5.5時間以上',
  })

  // ── 5. 排便（15点）────────────────────────────────────
  const bowelOk = log.bowel_movement === true ? true : log.bowel_movement === false ? false : null
  if (bowelOk === true) basePoints += 15
  metrics.push({
    key: 'bowel', label: '排便', maxPoints: 15,
    points:    bowelOk === true ? 15 : 0,
    achieved:  bowelOk,
    value:     log.bowel_movement === true ? 'あり' : log.bowel_movement === false ? 'なし' : null,
    remaining: null,
    threshold: 'あり',
  })

  // ── 6. 食事写真（15点：実際に食べた食事のうち写真登録できた割合）──
  // ate_breakfast / ate_lunch / ate_dinner は true=食べた・false=食べていない・null=未回答（既存カラム）
  const mealKeys  = ['breakfast', 'lunch', 'dinner']
  const mealLabel = { breakfast: '朝食', lunch: '昼食', dinner: '夕食' }
  const mealDetail = mealKeys.map((k) => ({
    key:      k,
    label:    mealLabel[k],
    eaten:    log[`ate_${k}`] === true ? true : log[`ate_${k}`] === false ? false : null,
    hasPhoto: !!(mealLog && mealLog[`${k}_photo_url`]),
  }))
  const eatenMeals        = mealDetail.filter((m) => m.eaten === true)
  const unansweredMeals   = mealDetail.filter((m) => m.eaten === null)
  const photographedEaten = eatenMeals.filter((m) => m.hasPhoto)

  let mealPhotoPoints   = 0
  let mealPhotoAchieved = null // true=満点確定 / false=一部のみ・0食で確定 / null=未確定（入力待ち）
  if (eatenMeals.length > 0) {
    mealPhotoPoints = Math.round((15 * photographedEaten.length / eatenMeals.length) * 2) / 2
    if (unansweredMeals.length === 0) {
      mealPhotoAchieved = photographedEaten.length === eatenMeals.length
    }
  } else if (unansweredMeals.length === 0) {
    // 3食とも「食べていない」と回答済み → 採点対象なしで0点確定（未判定ではない）
    mealPhotoAchieved = false
  }
  basePoints += mealPhotoPoints
  metrics.push({
    key: 'meal_photo', label: '食事写真', maxPoints: 15,
    points:          mealPhotoPoints,
    achieved:        mealPhotoAchieved,
    meals:           mealDetail,
    eatenCount:      eatenMeals.length,
    unansweredCount: unansweredMeals.length,
    threshold:       '実際に食べた食事の写真登録割合',
  })

  basePoints = Math.min(Math.round(basePoints * 2) / 2, 100)

  // ── 間食による減点（写真の有無は無関係。ate_snack フラグのみで判定）──
  const snackFlag    = log.ate_snack === true ? true : log.ate_snack === false ? false : null
  const snackPenalty = snackFlag === true ? 10 : 0
  const score = Math.max(0, Math.round((basePoints - snackPenalty) * 2) / 2)

  // ── 今日の「現在点／到達可能点」（今日のみ算出）──────────
  const maxPossibleScore = Math.max(0, 100 - snackPenalty)
  const potential = isToday
    ? { current: score, max: maxPossibleScore, remaining: +(maxPossibleScore - score).toFixed(1) }
    : null

  const advice = buildAdvice({ metrics, basePoints, snackFlag, isToday })

  return {
    score, basePoints, isToday, isFinal: !isToday,
    metrics,
    snack: { flag: snackFlag, penalty: snackPenalty },
    potential,
    advice,
  }
}

// ── アドバイス生成 ──────────────────────────────────────────
function buildAdvice({ metrics, basePoints, snackFlag, isToday }) {
  if (!isToday) {
    const ngItems = metrics.filter((m) => m.achieved === false)
    if (basePoints >= 100 && ngItems.length === 0) {
      return { heading: '明日のアドバイス', items: ['全ての項目をクリアしました！この調子を続けましょう。'] }
    }
    if (ngItems.length > 0) {
      const labels = ngItems.map((m) => m.label).join('・')
      return { heading: '明日のアドバイス', items: [`${labels}を意識してみましょう。`] }
    }
    return { heading: '明日のアドバイス', items: ['記録を続けることが大切です。今日も頑張りました。'] }
  }

  const byKey  = Object.fromEntries(metrics.map((m) => [m.key, m]))
  const items  = []
  const weight = byKey.weight_change

  if (weight.pending === 'morning')      items.push('朝体重を入力しましょう')
  else if (weight.pending === 'evening') items.push('夜体重を忘れずに入力しましょう')

  if (byKey.water.achieved === false)       items.push(`水分をあと${byKey.water.remaining}飲むと+20点です`)
  else if (byKey.water.achieved === null)   items.push('水分量を入力しましょう')

  if (byKey.toilet.achieved === false)      items.push(`トイレ回数はあと${byKey.toilet.remaining}で+15点です`)
  else if (byKey.toilet.achieved === null)  items.push('トイレ回数を入力しましょう')

  if (byKey.sleep.achieved === null)        items.push('睡眠時間を入力しましょう')

  if (byKey.bowel.achieved === null)        items.push('排便の有無を入力しましょう')

  const meal = byKey.meal_photo
  if (meal.eatenCount > 0 && meal.meals.some((m) => m.eaten === true && !m.hasPhoto)) {
    items.push('食べた食事の写真を登録しましょう')
  } else if (meal.eatenCount === 0 && meal.unansweredCount > 0) {
    items.push('食べた食事を記録しましょう')
  }

  if (snackFlag === null) items.push('間食を控えると10点の減点を防げます')

  if (items.length === 0) items.push('素晴らしいペースです！このまま続けましょう。')

  return { heading: '今日このあとのポイント', items }
}

/** スコアに対応する色クラス（最終評価表示でのみ使用） */
export function scoreColor(score) {
  if (score >= 85) return { text: 'text-green-600',  bg: 'bg-green-50',  border: 'border-green-200' }
  if (score >= 70) return { text: 'text-blue-600',   bg: 'bg-blue-50',   border: 'border-blue-200'  }
  if (score >= 55) return { text: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200'}
  return               { text: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200'}
}

/** スコアに対応するラベル（最終評価表示でのみ使用。今日の入力途中には使わない） */
export function scoreLabel(score) {
  if (score >= 90) return '最高'
  if (score >= 80) return '良好'
  if (score >= 70) return 'まずまず'
  if (score >= 55) return '要改善'
  return '要注意'
}

/** 入力途中（今日）用の色クラス：中立トーンで統一 */
export function pendingColor() {
  return { text: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' }
}
