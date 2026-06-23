import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { CATEGORIES, CAT_CONFIG, fmt } from '../data/items'

const RADIAN = Math.PI / 180

function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.06) return null
  const r = innerRadius + (outerRadius - innerRadius) * 0.52
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text
      x={x} y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      style={{ fontSize: 11, fontWeight: 700 }}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

function EmptyState() {
  return (
    <div
      className="rounded-2xl bg-white p-10 text-center"
      style={{ border: '1.5px dashed #E5E0D8' }}
    >
      <div className="text-5xl mb-5">📊</div>
      <p
        className="text-[10px] font-semibold tracking-widest mb-3"
        style={{ color: '#C9A96E' }}
      >
        RESULT
      </p>
      <p className="text-sm leading-loose" style={{ color: '#B0A99F' }}>
        左のスライダーを動かすと<br />
        リアルタイムで診断結果が表示されます
      </p>
    </div>
  )
}

export default function ResultsPanel({ totals, categoryTotals }) {
  const annual  = totals.monthly * 12
  const fatKg   = totals.monthlyKcal / 7200
  const hasInput = totals.monthly > 0

  const pieData = CATEGORIES
    .map((cat) => ({
      name:  cat,
      value: Math.round(categoryTotals[cat]?.monthly || 0),
      color: CAT_CONFIG[cat].color,
    }))
    .filter((d) => d.value > 0)

  let advice = null
  if (hasInput) {
    if (annual < 100_000) {
      advice = {
        text:  '素晴らしいです！あと一歩、無意識の習慣を見直すだけで理想の体型に近づきます。',
        color: '#7B98B2',
        icon:  '✨',
      }
    } else if (annual < 200_000) {
      advice = {
        text:  `年間で約¥${fmt(annual)}が脂肪に変わっています。この一部を「未来の健康と美への投資」に変えてみませんか？`,
        color: '#C9A96E',
        icon:  '💡',
      }
    } else {
      advice = {
        text:  '非常に大きな伸び代があります！この出費をサロンでの集中ケアや高品質な栄養投資に置き換えるだけで、人生が変わるレベルのダイエットが可能です。',
        color: '#C4897B',
        icon:  '🔥',
      }
    }
  }

  const shareText =
    `【習慣チェッカー 診断結果】\n\n` +
    `📌 月間出費：¥${fmt(totals.monthly)}\n` +
    `📌 年間出費：¥${fmt(annual)}\n` +
    `📌 毎月の脂肪リスク：約 ${fatKg.toFixed(1)} kg\n\n` +
    (advice ? `${advice.icon} ${advice.text}` : '')

  const handleShare = () => {
    const encoded = encodeURIComponent(shareText)
    if (/iPhone|iPad|Android/.test(navigator.userAgent)) {
      window.location.href = `https://line.me/R/msg/text/?${encoded}`
    } else {
      navigator.clipboard
        .writeText(shareText)
        .then(() => alert('結果をクリップボードにコピーしました！\nLINEに貼り付けてお送りください。'))
        .catch(() => window.prompt('以下をコピーしてください：', shareText))
    }
  }

  if (!hasInput) return <EmptyState />

  return (
    <div className="animate-fade-up space-y-3">
      {/* Section label */}
      <div className="text-center pb-1">
        <div
          className="mb-3"
          style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(201,169,110,0.5), transparent)' }}
        />
        <p
          className="text-[10px] font-medium"
          style={{ letterSpacing: '0.22em', color: '#C9A96E' }}
        >
          RESULT
        </p>
        <h2
          className="font-serif text-[1.6rem] font-light mt-1"
          style={{ color: '#1C2951' }}
        >
          診断結果
        </h2>
      </div>

      {/* ── Hero card ── */}
      <div
        className="rounded-2xl p-6 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1C2951 0%, #2D3E6E 60%, #1C2951 100%)' }}
      >
        {/* Glow orbs */}
        <div
          className="absolute -top-10 -right-10 w-40 h-40 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(201,169,110,0.18) 0%, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-5 -left-5 w-28 h-28 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(201,169,110,0.1) 0%, transparent 70%)' }}
        />

        <p
          className="text-[10px] font-medium mb-1.5 relative"
          style={{ letterSpacing: '0.18em', color: '#C9A96E' }}
        >
          あなたの「太る習慣」への投資額
        </p>

        {/* Monthly total */}
        <div className="flex items-baseline gap-1.5 mb-1 relative">
          <span className="text-xs" style={{ color: '#9CA3AF' }}>月</span>
          <span
            className="font-serif font-semibold text-white leading-none"
            style={{ fontSize: '2.8rem', letterSpacing: '-0.02em' }}
          >
            ¥{fmt(totals.monthly)}
          </span>
        </div>

        {/* Annual badge */}
        <div className="mb-5 relative">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
            style={{
              background: 'rgba(201,169,110,0.18)',
              border:     '1px solid rgba(201,169,110,0.35)',
              color:      '#E0C07A',
            }}
          >
            <span className="text-[10px] opacity-80">年間</span>
            ¥{fmt(annual)}
          </span>
        </div>

        {/* Fat accumulation */}
        <div
          className="pt-4 flex items-center gap-3.5 relative"
          style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}
        >
          <div
            className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center text-xl"
            style={{ background: 'rgba(196,137,123,0.2)' }}
          >
            ⚠️
          </div>
          <div>
            <p className="text-[11px] mb-0.5" style={{ color: '#9CA3AF' }}>
              毎月蓄積される脂肪リスク
            </p>
            <p
              className="text-xl font-bold"
              style={{ color: '#E8A89A', letterSpacing: '-0.01em' }}
            >
              約 {fatKg.toFixed(1)} kg
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: '#6B7280' }}>
              摂取 {Math.round(totals.monthlyKcal).toLocaleString()} kcal / 月 ÷ 7,200 kcal
            </p>
          </div>
        </div>
      </div>

      {/* ── Pie chart ── */}
      {pieData.length > 0 && (
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p
            className="text-[11px] font-bold tracking-wider mb-1"
            style={{ color: '#1C2951' }}
          >
            カテゴリ別 出費割合
          </p>
          <p className="text-[11px] mb-4" style={{ color: '#B0A99F' }}>
            月合計 ¥{fmt(totals.monthly)}
          </p>

          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={54}
                outerRadius={88}
                paddingAngle={3}
                dataKey="value"
                labelLine={false}
                label={<PieLabel />}
                startAngle={90}
                endAngle={-270}
              >
                {pieData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v) => [`¥${v.toLocaleString()}`, '月額']}
                contentStyle={{
                  borderRadius: 10,
                  border:       '1px solid #E5E0D8',
                  fontSize:     12,
                  boxShadow:    '0 4px 12px rgba(0,0,0,0.08)',
                }}
                itemStyle={{ color: '#1C2951' }}
              />
            </PieChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center mt-1">
            {pieData.map((d, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                <span className="text-[11px]" style={{ color: '#6B7280' }}>{d.name}</span>
                <span className="text-[11px]" style={{ color: '#9CA3AF' }}>¥{fmt(d.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Advice card ── */}
      {advice && (
        <div
          className="rounded-xl p-5 relative overflow-hidden"
          style={{
            background: `${advice.color}0E`,
            border:     `1.5px solid ${advice.color}30`,
          }}
        >
          {/* Left accent bar */}
          <div
            className="absolute top-0 left-0 w-1 h-full"
            style={{ background: advice.color }}
          />
          <p
            className="text-[10px] font-bold tracking-widest mb-2 ml-1"
            style={{ color: advice.color }}
          >
            {advice.icon} 未来への提案
          </p>
          <p className="text-[13px] leading-loose ml-1" style={{ color: '#1C2951' }}>
            {advice.text}
          </p>
        </div>
      )}

      {/* ── Share button ── */}
      <button
        onClick={handleShare}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-bold text-white transition-transform duration-150 active:scale-[0.98] hover:brightness-105"
        style={{
          background:   'linear-gradient(135deg, #C9A96E 0%, #DEB87A 50%, #C9A96E 100%)',
          boxShadow:    '0 4px 18px rgba(201,169,110,0.4)',
          letterSpacing:'0.04em',
        }}
      >
        <span className="text-lg">💬</span>
        この結果をLINEで送る（カウンセリング記録用）
      </button>
    </div>
  )
}
