import { useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { fmt, PIE_CATEGORIES } from '../data/questions'

// ─── ヘルパー ───────────────────────────────────────────────────
const RADIAN = Math.PI / 180
function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.07) return null
  const r = innerRadius + (outerRadius - innerRadius) * 0.52
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" style={{ fontSize: 11, fontWeight: 700 }}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

// ピンク系パレット（円グラフ用に上書き）
const PIE_COLORS = {
  drink:    '#E8A0B0',
  food:     '#C4778A',
  medical:  '#A8C4D4',
  costOnly: '#D4A0B8',
  timeLoss: '#C8B4CC',
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div
      className="rounded-2xl p-4 flex-1"
      style={{ background: `${accent}12`, border: `1px solid ${accent}35` }}
    >
      <p className="text-[10px] font-bold tracking-widest mb-1" style={{ color: accent }}>
        {label}
      </p>
      <p className="text-xl font-bold" style={{ color: '#2D1F2D', letterSpacing: '-0.02em' }}>
        {value}
      </p>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: '#C4A8B0' }}>{sub}</p>}
    </div>
  )
}

// ─── カウンセリングシート生成 ────────────────────────────────────
function generateCounselingText(results) {
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
  const { monthly, totalMonthly, annualTotal, fiveYearTotal, monthlyKcal, monthlyFatKg, annualTimeLossHours, annualTimeLossValue } = results

  return `━━━━━━━━━━━━━━━━━━━━━━
【見える化診断 カウンセリングシート】
診断日：${today}
━━━━━━━━━━━━━━━━━━━━━━

■ 総合サマリー
月間合計：¥${fmt(totalMonthly)}
年間合計：¥${fmt(annualTotal)}
5年間継続した場合：¥${fmt(fiveYearTotal)}

■ カテゴリ別 月間内訳
飲み物：     ¥${fmt(monthly.drink)}
食べ物：     ¥${fmt(monthly.food)}
医療・ケア：  ¥${fmt(monthly.medical)}
習慣出費：   ¥${fmt(monthly.costOnly)}
時間損失換算：¥${fmt(monthly.timeLoss)}

■ 体への影響（目安）
月間カロリーリスク：${Math.round(monthlyKcal).toLocaleString()} kcal
脂肪換算リスク：約 ${monthlyFatKg.toFixed(1)} kg/月
※脂肪1kg = 7,200kcal換算の目安値です

■ 時間の損失
年間時間損失：約 ${annualTimeLossHours} 時間
時間価値換算：¥${fmt(annualTimeLossValue)}（時給1,500円換算）

━━━━━━━━━━━━━━━━━━━━━━
【提案書】
━━━━━━━━━━━━━━━━━━━━━━

■ お客様の現状
お客様は現在、今の体を「維持する」ために
月間 ¥${fmt(totalMonthly)} を使われています。
これは年間で ¥${fmt(annualTotal)} になります。

■ もし3ヶ月間、習慣を見直したら…
3ヶ月間の節約可能額：¥${fmt(totalMonthly * 3)}
→ サロンでの集中ケア・プログラムへの投資が可能です

■ 提案のポイント
・今の出費の一部を「体を整えるため」に使う
・3ヶ月で体型の変化を実感いただく
・その後は毎月の節約分が丸々貯金に
・体型カバーから「着たい服が着られる」生活へ

━━━━━━━━━━━━━━━━━━━━━━
【LINEフォロー文】
━━━━━━━━━━━━━━━━━━━━━━

本日はご来院ありがとうございました。
診断結果をご確認いただきありがとうございます。

あなたは今、現状維持のために
月間 ¥${fmt(totalMonthly)} を使われています。

これを「未来の自分への投資」に
少しずつ振り替えていくだけで、
3ヶ月後には体も、毎月の家計も
大きく変わる可能性があります。

何かご不明な点がございましたら
いつでもご連絡ください。

━━━━━━━━━━━━━━━━━━━━━━
※この診断は医療診断ではありません。
　体調・疾患については必ず医師にご相談ください。`
}

function generateLineText(results) {
  const { totalMonthly, annualTotal, fiveYearTotal, monthlyFatKg } = results
  return `【体とお金の見える化診断 結果】

📌 月間習慣出費：¥${fmt(totalMonthly)}
📌 年間合計：¥${fmt(annualTotal)}
📌 5年間継続した場合：¥${fmt(fiveYearTotal)}
⚠️ 月間脂肪リスク：約 ${monthlyFatKg.toFixed(1)} kg

このお金を体型を整えるために使えたら
3ヶ月後、毎月 ¥${fmt(totalMonthly)} が貯金に変わります。

※医療診断ではありません`
}

// ─── メインコンポーネント ────────────────────────────────────────
export default function ResultsScreen({ results, onRetry }) {
  const [copied, setCopied]       = useState(null)
  const [showSheet, setShowSheet] = useState(false)

  const { monthly, totalMonthly, annualTotal, fiveYearTotal, monthlyKcal, monthlyFatKg, annualTimeLossHours, annualTimeLossValue } = results

  const pieData = PIE_CATEGORIES
    .map((c) => ({ name: c.label, value: Math.round(monthly[c.key] || 0), color: PIE_COLORS[c.key] }))
    .filter((d) => d.value > 0)

  const copyText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 2500)
    } catch {
      window.prompt('以下をコピーしてください：', text)
    }
  }

  const handleLine = () => {
    const text = generateLineText(results)
    const encoded = encodeURIComponent(text)
    if (/iPhone|iPad|Android/.test(navigator.userAgent)) {
      window.location.href = `https://line.me/R/msg/text/?${encoded}`
    } else {
      copyText(text, 'line')
    }
  }

  const savings = [
    { period: '3ヶ月後', amount: totalMonthly * 3,  example: '理想のサロン体験や集中ケアへ' },
    { period: '半年後',  amount: totalMonthly * 6,  example: '好きな服を思い切り選べる' },
    { period: '1年後',   amount: totalMonthly * 12, example: '旅行やご褒美体験ができる' },
    { period: '3年後',   amount: totalMonthly * 36, example: '人生が変わるレベルの自己投資' },
  ]

  return (
    <div className="min-h-screen pb-16" style={{ background: '#FFF8F9' }}>
      {/* ヒーローヘッダー */}
      <div
        className="relative overflow-hidden text-center px-6 py-10"
        style={{ background: 'linear-gradient(160deg, #C4778A 0%, #D4889A 50%, #C4778A 100%)' }}
      >
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 50% -20%, rgba(255,255,255,0.15) 0%, transparent 65%)' }} />
        <p className="text-[10px] font-medium tracking-[0.3em] mb-3 relative" style={{ color: 'rgba(255,255,255,0.8)' }}>
          DIAGNOSIS RESULT
        </p>
        <h2 className="font-serif text-white text-2xl font-light mb-2 relative" style={{ letterSpacing: '0.04em' }}>
          診断結果
        </h2>
        <p className="text-sm relative" style={{ color: 'rgba(255,255,255,0.75)' }}>
          あなたの体とお金の現状レポート
        </p>
      </div>

      <div className="px-4 pt-6 space-y-4 animate-fade-up" style={{ maxWidth: 520, margin: '0 auto' }}>

        {/* ── メインヒーローカード ── */}
        <div
          className="rounded-2xl p-6 relative overflow-hidden"
          style={{ background: 'white', border: '1.5px solid #F5C8D5', boxShadow: '0 4px 24px rgba(196,119,138,0.12)' }}
        >
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(196,119,138,0.08) 0%, transparent 70%)' }} />

          <p className="text-[10px] font-medium tracking-widest mb-1.5 relative" style={{ color: '#C4778A' }}>
            今の習慣にかかっている費用
          </p>
          <div className="flex items-baseline gap-1.5 mb-1 relative">
            <span className="text-xs" style={{ color: '#C4A8B0' }}>月</span>
            <span className="font-serif font-semibold leading-none" style={{ fontSize: '2.8rem', letterSpacing: '-0.02em', color: '#2D1F2D' }}>
              ¥{fmt(totalMonthly)}
            </span>
          </div>
          <div className="flex gap-2 mb-5 relative flex-wrap">
            <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold"
              style={{ background: '#FFF0F4', border: '1px solid #F5C8D5', color: '#C4778A' }}>
              年間 ¥{fmt(annualTotal)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold"
              style={{ background: '#FFF5F0', border: '1px solid #F5D5C8', color: '#C47860' }}>
              5年間 ¥{fmt(fiveYearTotal)}
            </span>
          </div>

          <div className="pt-4 flex items-center gap-3.5 relative" style={{ borderTop: '1px solid #F5E8EC' }}>
            <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-lg"
              style={{ background: '#FFF0F4' }}>
              ⚠️
            </div>
            <div>
              <p className="text-[11px] mb-0.5" style={{ color: '#C4A8B0' }}>毎月の脂肪リスク（目安）</p>
              <p className="text-xl font-bold" style={{ color: '#C4778A', letterSpacing: '-0.01em' }}>
                約 {monthlyFatKg.toFixed(1)} kg
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: '#C4A8B0' }}>
                月{Math.round(monthlyKcal).toLocaleString()} kcal ÷ 7,200 kcal（脂肪換算の目安）
              </p>
            </div>
          </div>
        </div>

        {/* ── 前向きメッセージ ── */}
        <div
          className="rounded-2xl p-5"
          style={{ background: 'white', border: '1px solid #F5E8EC', boxShadow: '0 2px 12px rgba(196,119,138,0.06)' }}
        >
          <p className="text-[11px] font-bold tracking-widest mb-2" style={{ color: '#C4778A' }}>
            ✨ あなたへのメッセージ
          </p>
          <p className="text-sm leading-loose" style={{ color: '#2D1F2D' }}>
            あなたは責められるべき生活をしているわけではありません。<br />
            ただ、今の体を<strong>維持するために</strong>、思っている以上のお金と時間を使っている可能性があります。
          </p>
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid #F5E8EC' }}>
            <p className="text-sm leading-loose" style={{ color: '#2D1F2D' }}>
              このお金を、体を隠すためではなく<br />
              <strong>体を整えるために使えたらどうでしょう？</strong>
            </p>
          </div>
        </div>

        {/* ── サブ統計カード ── */}
        <div className="flex gap-3">
          <StatCard label="医療・ケア" value={`¥${fmt(monthly.medical)}`} sub="月額" accent="#A8C4D4" />
          <StatCard label="体型カバー" value={`¥${fmt(monthly.costOnly)}`} sub="月額" accent="#D4A0B8" />
        </div>

        {annualTimeLossHours > 0 && (
          <div
            className="rounded-2xl p-4"
            style={{ background: 'white', border: '1px solid #E8D4E0', boxShadow: '0 2px 8px rgba(196,119,138,0.06)' }}
          >
            <p className="text-[10px] font-bold tracking-widest mb-2" style={{ color: '#C8B4CC' }}>
              ⏰ 時間の損失
            </p>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-bold" style={{ color: '#2D1F2D' }}>年間 {annualTimeLossHours} 時間</p>
                <p className="text-[10px] mt-0.5" style={{ color: '#C4A8B0' }}>病院・整体・薬局への移動・待合時間</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold" style={{ color: '#C8B4CC' }}>¥{fmt(annualTimeLossValue)}</p>
                <p className="text-[10px] mt-0.5" style={{ color: '#C4A8B0' }}>時給1,500円換算</p>
              </div>
            </div>
          </div>
        )}

        {/* ── 円グラフ ── */}
        {pieData.length > 0 && (
          <div
            className="rounded-2xl p-5"
            style={{ background: 'white', border: '1px solid #F5E8EC', boxShadow: '0 2px 12px rgba(196,119,138,0.06)' }}
          >
            <p className="text-[11px] font-bold tracking-wider mb-1" style={{ color: '#2D1F2D' }}>
              カテゴリ別 出費割合
            </p>
            <p className="text-[11px] mb-4" style={{ color: '#C4A8B0' }}>月合計 ¥{fmt(totalMonthly)}</p>

            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData} cx="50%" cy="50%"
                  innerRadius={54} outerRadius={88}
                  paddingAngle={3} dataKey="value"
                  labelLine={false} label={<PieLabel />}
                  startAngle={90} endAngle={-270}
                >
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip
                  formatter={(v) => [`¥${v.toLocaleString()}`, '月額']}
                  contentStyle={{ borderRadius: 10, border: '1px solid #F5E8EC', fontSize: 12, boxShadow: '0 4px 12px rgba(196,119,138,0.1)' }}
                />
              </PieChart>
            </ResponsiveContainer>

            <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center mt-1">
              {pieData.map((d, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                  <span className="text-[11px]" style={{ color: '#6B4A58' }}>{d.name}</span>
                  <span className="text-[11px]" style={{ color: '#C4A8B0' }}>¥{fmt(d.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 貯金シミュレーション ── */}
        <div
          className="rounded-2xl p-5"
          style={{ background: 'white', border: '1px solid #F5E8EC', boxShadow: '0 2px 12px rgba(196,119,138,0.06)' }}
        >
          <p className="text-[11px] font-bold tracking-wider mb-1" style={{ color: '#C4778A' }}>
            🌸 習慣を変えたら、3ヶ月後には…
          </p>
          <p className="text-[11px] mb-4 leading-relaxed" style={{ color: '#C4A8B0' }}>
            今の習慣の使い道を変えるだけで、こんな未来が生まれます
          </p>
          <div className="space-y-3">
            {savings.map(({ period, amount, example }) => (
              <div
                key={period}
                className="flex items-center gap-3 rounded-xl p-3"
                style={{ background: '#FFF5F7', border: '1px solid #F5E8EC' }}
              >
                <div
                  className="rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ background: 'linear-gradient(135deg, #C4778A, #E8A0B0)', minWidth: 52, height: 36, padding: '0 8px' }}
                >
                  {period}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold" style={{ color: '#2D1F2D' }}>¥{fmt(amount)}</p>
                  <p className="text-[10px]" style={{ color: '#C4A8B0' }}>{example}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid #F5E8EC' }}>
            <p className="text-[12px] leading-loose text-center" style={{ color: '#2D1F2D' }}>
              <strong>今日から少しずつ使い道を変えていきましょう。</strong><br />
              <span style={{ color: '#C4A8B0' }}>未来の健康と理想の体型のために。</span>
            </p>
          </div>
        </div>

        {/* ── 注意書き ── */}
        <div className="rounded-xl p-4" style={{ background: 'rgba(196,168,176,0.08)', border: '1px solid rgba(196,168,176,0.2)' }}>
          <p className="text-[10px] leading-loose" style={{ color: '#C4A8B0' }}>
            ※ この診断は医療診断ではありません。脂肪リスクは目安の参考値です（脂肪1kg = 7,200kcal換算）。体調・疾患については必ず医師にご相談ください。計算結果はあくまで生活習慣の傾向把握を目的としています。
          </p>
        </div>

        {/* ── アクションボタン ── */}
        <div className="space-y-3 pt-2">
          <button
            onClick={handleLine}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-bold text-white transition-all duration-150 active:scale-[0.98]"
            style={{
              background:    'linear-gradient(135deg, #06C755 0%, #06B84E 100%)',
              boxShadow:     '0 4px 18px rgba(6,199,85,0.3)',
              letterSpacing: '0.04em',
            }}
          >
            <span className="text-lg">💬</span>
            {copied === 'line' ? 'コピーしました！' : 'この結果をLINEで送る'}
          </button>

          <button
            onClick={() => setShowSheet((s) => !s)}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-bold transition-all duration-150 active:scale-[0.98]"
            style={{
              background:    'white',
              border:        '1.5px solid #E8A0B0',
              color:         '#C4778A',
              boxShadow:     '0 2px 12px rgba(196,119,138,0.12)',
              letterSpacing: '0.04em',
            }}
          >
            <span className="text-base">📋</span>
            カウンセリング資料を{showSheet ? '閉じる' : '生成する'}
          </button>

          {showSheet && (
            <div
              className="rounded-2xl overflow-hidden animate-fade-up"
              style={{ background: 'white', border: '1px solid #F5E8EC', boxShadow: '0 2px 12px rgba(196,119,138,0.08)' }}
            >
              <div className="px-5 py-4" style={{ borderBottom: '1px solid #F5E8EC', background: '#FFF8F9' }}>
                <p className="text-[11px] font-bold tracking-wider" style={{ color: '#2D1F2D' }}>
                  カウンセリングシート・提案書・LINEフォロー文
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: '#C4A8B0' }}>以下をコピーしてご利用ください</p>
              </div>
              <div className="p-4">
                <pre
                  className="text-[11px] leading-relaxed whitespace-pre-wrap break-words rounded-xl p-4 overflow-auto"
                  style={{ background: '#FFF5F7', color: '#6B4A58', maxHeight: 320, fontFamily: 'inherit' }}
                >
                  {generateCounselingText(results)}
                </pre>
                <button
                  onClick={() => copyText(generateCounselingText(results), 'sheet')}
                  className="w-full mt-3 py-3 rounded-xl text-xs font-bold transition-all duration-150 active:scale-[0.98]"
                  style={{
                    background: copied === 'sheet' ? '#C4778A' : '#FFF0F4',
                    color:      copied === 'sheet' ? 'white'    : '#C4778A',
                    border:     '1px solid #F5C8D5',
                  }}
                >
                  {copied === 'sheet' ? '✓ コピーしました！' : '📋 全文をコピー'}
                </button>
              </div>
            </div>
          )}

          <button
            onClick={onRetry}
            className="w-full py-3.5 rounded-xl text-sm transition-all duration-150 active:scale-[0.98]"
            style={{ border: '1.5px dashed #F5C8D5', color: '#C4A8B0', background: 'transparent', letterSpacing: '0.04em' }}
          >
            ↺ もう一度診断する
          </button>
        </div>

      </div>
    </div>
  )
}
