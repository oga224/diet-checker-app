import { useState, useMemo } from 'react'
import AppHeader from './components/AppHeader'
import CategorySection from './components/CategorySection'
import ResultsPanel from './components/ResultsPanel'
import { ITEMS_DATA, CATEGORIES } from './data/items'

const buildInitialState = () => {
  const s = {}
  ITEMS_DATA.forEach((item) => {
    s[item.id] = { frequency: 0, price: item.defaultPrice }
  })
  return s
}

export default function App() {
  const [states, setStates] = useState(buildInitialState)

  const handleFreq  = (id, freq)  => setStates((prev) => ({ ...prev, [id]: { ...prev[id], frequency: freq } }))
  const handlePrice = (id, price) => setStates((prev) => ({ ...prev, [id]: { ...prev[id], price } }))
  const handleReset = () => setStates(buildInitialState())

  const { totals, categoryTotals } = useMemo(() => {
    let monthly = 0, monthlyKcal = 0
    const catTotals = {}
    CATEGORIES.forEach((c) => { catTotals[c] = { monthly: 0, monthlyKcal: 0 } })

    ITEMS_DATA.forEach((item) => {
      const { frequency, price } = states[item.id]
      const m  = price * frequency * 4.3
      const mk = item.kcal * frequency * 4.3
      monthly     += m
      monthlyKcal += mk
      catTotals[item.category].monthly     += m
      catTotals[item.category].monthlyKcal += mk
    })

    return { totals: { monthly, monthlyKcal }, categoryTotals: catTotals }
  }, [states])

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader />

      <main className="max-w-[1280px] mx-auto px-4 sm:px-6 xl:px-10 py-8">
        <div className="flex flex-col lg:flex-row gap-8 items-start">

          {/* ── Left: Input panel ── */}
          <div className="flex-1 min-w-0">
            {/* Intro */}
            <div
              className="bg-white rounded-2xl p-5 mb-6 shadow-sm"
              style={{ borderLeft: '4px solid #C9A96E' }}
            >
              <p className="text-sm text-navy leading-loose">
                毎日のちょっとした習慣が、実は<strong>お金と体型</strong>に大きな影響を与えています。
                各アイテムの週あたりの頻度をスライダーで選んで、あなたの現状を確認してみましょう。
              </p>
            </div>

            {/* Category sections */}
            {CATEGORIES.map((cat) => (
              <CategorySection
                key={cat}
                category={cat}
                items={ITEMS_DATA.filter((i) => i.category === cat)}
                states={states}
                onFrequencyChange={handleFreq}
                onPriceChange={handlePrice}
              />
            ))}

            {/* Reset */}
            <button
              onClick={handleReset}
              className="w-full mt-4 py-4 rounded-xl text-sm tracking-wider transition-all duration-200 cursor-pointer"
              style={{ border: '1.5px dashed #E5E0D8', color: '#B0A99F', background: 'transparent' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(201,169,110,0.5)'
                e.currentTarget.style.color = '#C9A96E'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#E5E0D8'
                e.currentTarget.style.color = '#B0A99F'
              }}
            >
              ↺ 入力内容をリセット
            </button>

            <p
              className="text-center text-[10px] mt-8 mb-4 tracking-wider"
              style={{ color: '#C8BFB5' }}
            >
              ※ 脂肪換算は目安値です（脂肪1kg = 7,200kcal換算）
            </p>
          </div>

          {/* ── Right: Results panel — sticky on desktop ── */}
          <div className="w-full lg:w-[420px] xl:w-[460px] shrink-0 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
            <ResultsPanel totals={totals} categoryTotals={categoryTotals} />
          </div>

        </div>
      </main>
    </div>
  )
}
