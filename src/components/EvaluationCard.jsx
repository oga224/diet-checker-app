import { evaluateLog, scoreColor, scoreLabel, pendingColor } from '../lib/evaluateLog'

// ── 状態判定・表示ヘルパー ───────────────────────────────────
// tone: achieved(達成・緑) / progress(入力済みだが未達成・今日は中立/過去は赤) / pending(未入力・中立)
function metricTone(metric, isToday) {
  if (metric.achieved === true)  return 'achieved'
  if (metric.achieved === false) return isToday ? 'progress' : 'failed'
  return 'pending'
}

function toneClasses(tone) {
  if (tone === 'achieved') return { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-600' }
  if (tone === 'progress') return { bg: 'bg-blue-50',  border: 'border-blue-200',  text: 'text-blue-600'  }
  if (tone === 'failed')   return { bg: 'bg-red-50',   border: 'border-red-200',   text: 'text-red-500'   }
  return { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-400' }
}

// 管理画面の「◯日の健康スコア」カード専用の文字色・太さ。
// 見やすさのため、緑・グレーは黒系に統一し、赤（未達成・進行中）だけ元の配色を維持する。
// full/compact 表示（顧客側の送信完了画面・履歴）は toneClasses をそのまま使うため、ここでは影響しない。
function adminToneTextClass(tone) {
  if (tone === 'failed')   return 'text-red-500'
  if (tone === 'progress') return 'text-blue-600'
  return 'text-gray-900'
}
function adminToneWeightClass(tone) {
  return tone === 'achieved' ? 'font-normal' : 'font-bold'
}

// 管理画面カードの「総合スコア」表示専用：要注意（過去日・55点未満）のオレンジのみ元の配色・太さを維持し、
// それ以外（緑・青・黄・入力途中の青）はすべて黒・通常太さに統一する。
function isAdminScoreWarning(score, isToday) {
  return !isToday && score < 55
}

function pendingText(metric) {
  if (metric.key === 'weight_change') {
    return metric.pending === 'morning' ? '朝体重の入力待ち' : '夜体重の入力待ち'
  }
  return `${metric.label}の入力待ち`
}

/** 汎用メトリクス（体重変化・水分量・トイレ回数・睡眠時間・排便）の表示テキスト */
function metricText(metric, tone) {
  if (tone === 'achieved') {
    return { title: metric.value ?? metric.threshold, sub: `+${metric.points}点` }
  }
  if (tone === 'progress') { // 今日・入力済みだが未達成
    if (metric.key === 'weight_change' || metric.remaining == null) {
      return { title: `現在${metric.value}`, sub: `${metric.threshold}で+${metric.maxPoints}点` }
    }
    return { title: `現在${metric.value}`, sub: `あと${metric.remaining}で+${metric.maxPoints}点` }
  }
  if (tone === 'failed') { // 過去日・未達成確定
    return { title: metric.value ?? '未入力', sub: `未達成（${metric.threshold}）` }
  }
  // pending
  return { title: pendingText(metric), sub: `${metric.threshold}で+${metric.maxPoints}点` }
}

function mealRowLabel(m) {
  if (m.eaten === true && m.hasPhoto)  return '登録済み'
  if (m.eaten === true && !m.hasPhoto) return '写真なし'
  if (m.eaten === false)               return '食べていない'
  return 'まだ未回答'
}
function mealRowTone(m, isToday) {
  if (m.eaten === true && m.hasPhoto)  return 'achieved'
  if (m.eaten === true && !m.hasPhoto) return isToday ? 'progress' : 'failed'
  if (m.eaten === false)               return 'neutral'
  return 'pending'
}
function mealRowTextClass(tone) {
  if (tone === 'achieved') return 'text-green-600 font-semibold'
  if (tone === 'progress') return 'text-blue-600 font-semibold'
  if (tone === 'failed')   return 'text-red-500 font-semibold'
  if (tone === 'neutral')  return 'text-gray-500'
  return 'text-gray-400'
}

function mealSummaryText(metric, isToday) {
  if (metric.eatenCount === 0 && metric.unansweredCount > 0) return '食事情報の入力待ちです'
  if (isToday) {
    const withPhoto = metric.meals.filter((m) => m.eaten === true && m.hasPhoto).length
    const missing   = metric.meals.filter((m) => m.eaten === true && !m.hasPhoto).length
    if (metric.unansweredCount > 0) {
      return `現在、食べた食事のうち${withPhoto}/${metric.eatenCount}食を撮影できています（暫定）`
    }
    if (missing === 0 && metric.eatenCount > 0) return '現在、食べた食事はすべて撮影できています。満点ペースです'
    return `あと${missing}食分の写真を登録すると満点です`
  }
  if (metric.achieved === true)  return `${metric.eatenCount}食中${metric.eatenCount}食、写真を登録できました`
  if (metric.achieved === false) {
    const withPhoto = metric.meals.filter((m) => m.hasPhoto).length
    return metric.eatenCount > 0 ? `${metric.eatenCount}食中${withPhoto}食のみ写真登録でした` : '食事の記録がありませんでした'
  }
  return '食事情報が不足しているため判定できません'
}

// ── フル表示：メトリクスタイル ──────────────────────────────
function MetricTile({ metric, isToday }) {
  const tone = metricTone(metric, isToday)
  const { title, sub } = metricText(metric, tone)
  const cls = toneClasses(tone)
  return (
    <div className={`rounded-xl px-4 py-3 flex flex-col gap-1 border ${cls.border} ${cls.bg}`}>
      <p className="text-xs text-gray-400 font-medium">{metric.label}</p>
      <p className={`text-lg font-black leading-tight ${cls.text}`}>{title}</p>
      <p className="text-xs text-gray-400">{sub}</p>
    </div>
  )
}

function MealPhotoTile({ metric, isToday }) {
  const tone = metricTone(metric, isToday)
  const cls = toneClasses(tone)
  return (
    <div className={`col-span-2 rounded-xl px-4 py-3 border ${cls.border} ${cls.bg}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-400 font-medium">食事写真{isToday ? '（暫定）' : ''}</p>
        <p className={`text-sm font-black ${cls.text}`}>
          +{metric.points}点<span className="text-xs text-gray-400 font-normal">/{metric.maxPoints}点</span>
        </p>
      </div>
      <div className="space-y-1 mb-2">
        {metric.meals.map((m) => (
          <div key={m.key} className="flex items-center justify-between text-xs">
            <span className="text-gray-500">{m.label}</span>
            <span className={mealRowTextClass(mealRowTone(m, isToday))}>{mealRowLabel(m)}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400">{mealSummaryText(metric, isToday)}</p>
    </div>
  )
}

function SnackTile({ snack }) {
  const tone = snack.flag === true ? 'failed' : snack.flag === false ? 'achieved' : 'pending'
  const cls  = toneClasses(tone)
  const title = snack.flag === true ? 'あり' : snack.flag === false ? 'なし' : '未入力'
  const sub   = snack.flag === true ? `-${snack.penalty}点` : snack.flag === false ? '減点なし' : '入力待ち'
  return (
    <div className={`rounded-xl px-4 py-3 flex flex-col gap-1 border ${cls.border} ${cls.bg}`}>
      <p className="text-xs text-gray-400 font-medium">間食</p>
      <p className={`text-lg font-black leading-tight ${cls.text}`}>{title}</p>
      <p className="text-xs text-gray-400">{sub}</p>
    </div>
  )
}

// ── 管理画面向け行表示（コンパクト）──────────────────────────
function MetricRow({ metric, isToday }) {
  const tone = metricTone(metric, isToday)
  const { title, sub } = metricText(metric, tone)
  return (
    <div className="flex items-center justify-between py-1.5 gap-2">
      <span className="text-[17px] text-gray-900 w-24 flex-shrink-0">{metric.label}</span>
      <span className={`text-[19px] text-right flex-1 ${adminToneTextClass(tone)} ${adminToneWeightClass(tone)}`}>{title}</span>
      <span className="text-[16px] text-gray-900 flex-shrink-0 whitespace-nowrap">{sub}</span>
    </div>
  )
}

function MealPhotoRow({ metric, isToday }) {
  const tone = metricTone(metric, isToday)
  return (
    <div className="flex items-center justify-between py-1.5 gap-2">
      <span className="text-[17px] text-gray-900 w-24 flex-shrink-0">食事写真</span>
      <span className={`text-[17px] text-right flex-1 ${adminToneTextClass(tone)}`}>{mealSummaryText(metric, isToday)}</span>
      <span className="text-[16px] text-gray-900 flex-shrink-0 whitespace-nowrap">
        +{metric.points}/{metric.maxPoints}点
      </span>
    </div>
  )
}

function SnackRow({ snack }) {
  const tone  = snack.flag === true ? 'failed' : snack.flag === false ? 'achieved' : 'pending'
  const title = snack.flag === true ? 'あり' : snack.flag === false ? 'なし' : '未入力'
  const sub   = snack.flag === true ? `-${snack.penalty}点` : snack.flag === false ? '減点なし' : '入力待ち'
  return (
    <div className="flex items-center justify-between py-1.5 gap-2">
      <span className="text-[17px] text-gray-900 w-24 flex-shrink-0">間食</span>
      <span className={`text-[19px] text-right flex-1 ${adminToneTextClass(tone)} ${adminToneWeightClass(tone)}`}>{title}</span>
      <span className="text-[16px] text-gray-900 flex-shrink-0 whitespace-nowrap">{sub}</span>
    </div>
  )
}

/**
 * 健康スコアカード（スマホ全表示・管理画面詳細・バッジ共用）
 * Props:
 *   log      - weight_logs の1行（.date が今日なら「入力途中」表示になる）
 *   prevKg   - 使用しない（後方互換のため残す）
 *   mealLog  - meal_logs の1行（省略可）
 *   compact  - true: 管理画面テーブル内バッジ表示
 *   admin    - true: 管理画面向け横並びメトリクス表示
 */
export default function EvaluationCard({
  log, prevKg = null, mealLog = null, compact = false, admin = false
}) {
  const { score, isToday, metrics, snack, potential, advice } = evaluateLog(log, prevKg, mealLog)
  const tone = isToday ? pendingColor() : scoreColor(score)
  const byKey = Object.fromEntries(metrics.map((m) => [m.key, m]))

  // ── コンパクト（テーブル内バッジ）──
  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${tone.bg} ${tone.text} ${tone.border}`}>
        {score}点
        <span className="font-normal opacity-60">{isToday ? '入力途中' : scoreLabel(score)}</span>
      </span>
    )
  }

  // ── 管理画面向けコンパクトパネル（admin=true）──
  if (admin) {
    const scoreWarning = isAdminScoreWarning(score, isToday)
    const scoreTextCls   = scoreWarning ? tone.text : 'text-gray-900'
    const scoreWeightCls = scoreWarning ? 'font-black' : 'font-normal'
    const labelWeightCls = scoreWarning ? 'font-bold'  : 'font-normal'
    return (
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
        {/* スコアヘッダー */}
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-12 h-12 rounded-full bg-white border-4 ${tone.border} flex flex-col items-center justify-center flex-shrink-0`}>
            <span className={`text-[19px] leading-none ${scoreTextCls} ${scoreWeightCls}`}>{score}</span>
            <span className="text-[15px] text-gray-900">点</span>
          </div>
          <div>
            <p className="text-[17px] text-gray-900">{isToday ? '今日の健康スコア' : 'この日の健康スコア'}</p>
            <p className={`text-[23px] ${scoreTextCls} ${scoreWeightCls}`}>
              {isToday ? `現在${score}点` : `${score}点`}{' '}
              <span className={`text-[19px] ${labelWeightCls}`}>{isToday ? '入力途中' : scoreLabel(score)}</span>
            </p>
            {isToday && potential && (
              <p className="text-[17px] text-gray-900 mt-0.5">
                最高到達可能点：{potential.max}点（あと{potential.remaining}点獲得可）
              </p>
            )}
          </div>
        </div>
        {/* メトリクス一覧 */}
        <div className="divide-y divide-gray-50">
          {['weight_change', 'water', 'toilet', 'sleep', 'bowel'].map((k) => (
            <MetricRow key={k} metric={byKey[k]} isToday={isToday} />
          ))}
          <SnackRow snack={snack} />
          <MealPhotoRow metric={byKey.meal_photo} isToday={isToday} />
        </div>
        {/* アドバイス */}
        <div className="mt-3 text-[17px] text-gray-900 bg-gray-50 rounded-lg px-3 py-2 leading-relaxed">
          <p className="font-bold text-gray-900 mb-1">{advice.heading}</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {advice.items.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      </div>
    )
  }

  // ── フル表示（スマホ・履歴画面）──
  return (
    <div className={`rounded-2xl border-2 ${tone.border} ${tone.bg} overflow-hidden`}>
      {/* ヘッダー：スコア */}
      <div className="px-5 py-5 flex items-center gap-4">
        <div className={`w-20 h-20 rounded-full bg-white border-4 ${tone.border} flex flex-col items-center justify-center flex-shrink-0 shadow-sm`}>
          <span className={`text-2xl font-black leading-none ${tone.text}`}>{score}</span>
          <span className="text-xs text-gray-400 font-medium mt-0.5">点</span>
        </div>
        <div>
          <p className="text-sm font-medium text-gray-500">{isToday ? '今日の獲得スコア' : 'この日の健康スコア'}</p>
          <p className={`text-3xl font-black ${tone.text} leading-none mt-0.5`}>
            {isToday ? `現在${score}点` : `${score}点`}
          </p>
          <span className={`text-sm font-bold ${tone.text}`}>
            {isToday ? '今日はまだ入力途中です' : scoreLabel(score)}
          </span>
          {isToday && potential && (
            <p className="text-xs text-gray-500 mt-1">
              今日このあと最大{potential.remaining}点獲得できます（最高到達可能点：{potential.max}点）
            </p>
          )}
        </div>
      </div>

      {/* メトリクスグリッド */}
      <div className="px-5 pb-2 grid grid-cols-2 gap-2">
        {['weight_change', 'water', 'toilet', 'sleep'].map((k) => (
          <MetricTile key={k} metric={byKey[k]} isToday={isToday} />
        ))}
        <MetricTile metric={byKey.bowel} isToday={isToday} />
        <SnackTile snack={snack} />
        <MealPhotoTile metric={byKey.meal_photo} isToday={isToday} />
      </div>

      {/* アドバイス */}
      <div className="px-5 pb-5 pt-3">
        <div className="bg-white/80 rounded-2xl px-4 py-3">
          <p className="text-xs font-bold text-gray-400 mb-1">{advice.heading}</p>
          <ul className="text-base text-gray-700 leading-relaxed list-disc pl-5 space-y-1">
            {advice.items.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      </div>
    </div>
  )
}
