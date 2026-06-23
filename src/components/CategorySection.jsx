import { useState } from 'react'
import ItemCard from './ItemCard'
import { CAT_CONFIG, fmt } from '../data/items'

export default function CategorySection({ category, items, states, onFrequencyChange, onPriceChange }) {
  const cfg = CAT_CONFIG[category]
  const [open, setOpen] = useState(true)

  const catMonthly = items.reduce((sum, item) => {
    const { frequency, price } = states[item.id]
    return sum + price * frequency * 4.3
  }, 0)

  return (
    <div className="mb-5">
      {/* Accordion header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between rounded-xl px-4 py-3 transition-all duration-200"
        style={{
          background:   open ? cfg.bg : '#FAFAF8',
          border:       `1.5px solid ${open ? cfg.color + '30' : '#EDE8E0'}`,
          marginBottom: open ? 10 : 0,
        }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
            style={{ background: cfg.badge }}
          >
            {cfg.icon}
          </span>
          <span className="text-sm font-bold tracking-wide" style={{ color: cfg.color }}>
            {category}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          {catMonthly > 0 && (
            <span className="text-xs font-semibold" style={{ color: cfg.color }}>
              月 ¥{fmt(catMonthly)}
            </span>
          )}
          <span
            className="text-xs transition-transform duration-200 inline-block"
            style={{ color: cfg.color, transform: open ? 'rotate(180deg)' : 'none' }}
          >
            ▾
          </span>
        </div>
      </button>

      {/* Items */}
      {open && items.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          state={states[item.id]}
          onFrequencyChange={(f) => onFrequencyChange(item.id, f)}
          onPriceChange={(p) => onPriceChange(item.id, p)}
        />
      ))}
    </div>
  )
}
