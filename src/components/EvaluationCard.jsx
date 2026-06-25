import { evaluateLog, scoreColor, scoreLabel } from '../lib/evaluateLog'

/**
 * ok === true  → 緑（クリア）
 * ok === false → 赤（未達）
 * ok === null  → グレー（未入力）
 */
function metricValueClass(ok) {
  if (ok === true)  return 'text-green-600'
  if (ok === false) return 'text-red-500'
  return 'text-gray-400'
}

/** メトリクス1件のタイル（全表示用） */
function MetricTile({ metric }) {
  const valClass = metricValueClass(metric.ok)
  return (
    <div className="bg-white rounded-xl px-4 py-3 flex flex-col gap-1 border border-gray-100">
      <p className="text-xs text-gray-400 font-medium">{metric.label}</p>
      <p className={`text-xl font-black leading-none ${valClass}`}>{metric.value}</p>
      <p className="text-xs text-gray-300">目標: {metric.threshold}</p>
    </div>
  )
}

/** メトリクス1件の行（管理画面テーブル内用・横並び） */
function MetricRow({ metric }) {
  const valClass = metricValueClass(metric.ok)
  return (
    <div className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 w-28 flex-shrink-0">{metric.label}</span>
      <span className={`text-sm font-bold ${valClass}`}>{metric.value}</span>
    </div>
  )
}

/**
 * 健康スコアカード（スマホ全表示・管理画面詳細・バッジ共用）
 * Props:
 *   log      - weight_logs の1行
 *   prevKg   - 使用しない（後方互換のため残す）
 *   mealLog  - meal_logs の1行（省略可）
 *   compact  - true: 管理画面テーブル内バッジ表示
 *   admin    - true: 管理画面向け横並びメトリクス表示
 */
export default function EvaluationCard({
  log, prevKg = null, mealLog = null, compact = false, admin = false
}) {
  const { score, metrics, advice } = evaluateLog(log, prevKg, mealLog)
  const color = scoreColor(score)

  // ── コンパクト（テーブル内バッジ）──
  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${color.bg} ${color.text} ${color.border}`}>
        {score}点
        <span className="font-normal opacity-60">{scoreLabel(score)}</span>
      </span>
    )
  }

  // ── 管理画面向けコンパクトパネル（admin=true）──
  if (admin) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
        {/* スコアヘッダー */}
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-12 h-12 rounded-full bg-white border-4 ${color.border} flex flex-col items-center justify-center flex-shrink-0`}>
            <span className={`text-sm font-black leading-none ${color.text}`}>{score}</span>
            <span className="text-[10px] text-gray-400">点</span>
          </div>
          <div>
            <p className="text-xs text-gray-400">今日の健康スコア</p>
            <p className={`text-lg font-black ${color.text}`}>{score}点 <span className="text-sm font-bold">{scoreLabel(score)}</span></p>
          </div>
        </div>
        {/* メトリクス一覧 */}
        <div className="divide-y divide-gray-50">
          {metrics.map((m) => <MetricRow key={m.key} metric={m} />)}
        </div>
        {/* アドバイス */}
        <p className="mt-3 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 leading-relaxed">{advice}</p>
      </div>
    )
  }

  // ── フル表示（スマホ・履歴画面）──
  return (
    <div className={`rounded-2xl border-2 ${color.border} ${color.bg} overflow-hidden`}>
      {/* ヘッダー：スコア */}
      <div className="px-5 py-5 flex items-center gap-4">
        <div className={`w-20 h-20 rounded-full bg-white border-4 ${color.border} flex flex-col items-center justify-center flex-shrink-0 shadow-sm`}>
          <span className={`text-2xl font-black leading-none ${color.text}`}>{score}</span>
          <span className="text-xs text-gray-400 font-medium mt-0.5">点</span>
        </div>
        <div>
          <p className="text-sm font-medium text-gray-500">今日の健康スコア</p>
          <p className={`text-3xl font-black ${color.text} leading-none mt-0.5`}>{score}点</p>
          <span className={`text-sm font-bold ${color.text}`}>{scoreLabel(score)}</span>
        </div>
      </div>

      {/* メトリクスグリッド */}
      <div className="px-5 pb-2 grid grid-cols-2 gap-2">
        {metrics.map((m) => <MetricTile key={m.key} metric={m} />)}
      </div>

      {/* アドバイス */}
      <div className="px-5 pb-5 pt-3">
        <div className="bg-white/80 rounded-2xl px-4 py-3">
          <p className="text-xs font-bold text-gray-400 mb-1">明日のアドバイス</p>
          <p className="text-base text-gray-700 leading-relaxed">{advice}</p>
        </div>
      </div>
    </div>
  )
}
