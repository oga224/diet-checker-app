import FrequencySlider from './FrequencySlider'
import { fmt } from '../data/items'

export default function ItemCard({ item, state, onFrequencyChange, onPriceChange }) {
  const { frequency, price } = state
  const isActive = frequency > 0
  const monthlySpend = price * frequency * 4.3

  return (
    <div
      className="rounded-2xl p-4 mb-2.5 transition-all duration-200"
      style={{
        border:     `1.5px solid ${isActive ? 'rgba(201,169,110,0.33)' : '#EDE8E0'}`,
        background: isActive ? '#FFFDF9' : '#FAFAF8',
        boxShadow:  isActive ? '0 2px 14px rgba(201,169,110,0.1)' : 'none',
      }}
    >
      {/* Name + price input */}
      <div className="flex justify-between items-start gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium leading-snug" style={{ color: '#1C2951' }}>
            {item.name}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: '#B0A99F' }}>
            {item.kcal.toLocaleString()} kcal / 回
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs" style={{ color: '#9CA3AF' }}>¥</span>
          <input
            type="number"
            value={price}
            onChange={(e) => onPriceChange(Math.max(0, parseInt(e.target.value) || 0))}
            className="text-right text-sm font-semibold rounded-lg px-2 py-1 outline-none focus:ring-1"
            style={{
              width: 68,
              border:      '1px solid #E5E0D8',
              background:  'white',
              color:       '#1C2951',
              '--tw-ring-color': '#C9A96E',
            }}
          />
        </div>
      </div>

      {/* Frequency slider */}
      <FrequencySlider value={frequency} onChange={onFrequencyChange} />

      {/* Monthly badge — shown only when active */}
      {isActive && (
        <div className="flex justify-end mt-2">
          <span
            className="text-[11px] font-semibold rounded-full px-2.5 py-0.5"
            style={{
              color:      '#C9A96E',
              background: '#FEF9F0',
              border:     '1px solid #F0E4C8',
            }}
          >
            月 ¥{fmt(monthlySpend)}
          </span>
        </div>
      )}
    </div>
  )
}
