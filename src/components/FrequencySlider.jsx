const TICKS = [0, 1, 2, 3, 4, 5, 6, 7]

export default function FrequencySlider({ value, onChange }) {
  const pct = `${(value / 7) * 100}%`

  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] shrink-0 w-4" style={{ color: '#9CA3AF' }}>週</span>

      <div className="flex-1">
        <input
          type="range"
          min="0"
          max="7"
          step="1"
          value={value}
          style={{ '--val': pct }}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between mt-1 px-0.5">
          {TICKS.map((n) => (
            <span
              key={n}
              className="text-[9px] leading-none transition-colors duration-150"
              style={{
                color:      value === n ? '#C9A96E' : '#D1C9BE',
                fontWeight: value === n ? 700 : 400,
              }}
            >
              {n}
            </span>
          ))}
        </div>
      </div>

      <div
        className="text-[13px] font-bold text-center transition-colors duration-200 shrink-0"
        style={{ minWidth: 46, color: value > 0 ? '#C9A96E' : '#D1C9BE' }}
      >
        {value === 0 ? 'なし' : `${value}回`}
      </div>
    </div>
  )
}
