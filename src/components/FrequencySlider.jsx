const TICKS = [0, 1, 2, 3, 4, 5, 6, 7]

export default function FrequencySlider({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] shrink-0 w-4" style={{ color: '#9CA3AF' }}>週</span>

      <div className="flex gap-1 flex-1">
        {TICKS.map((n) => {
          const active = value === n
          return (
            <button
              key={n}
              onClick={() => onChange(n)}
              className="flex-1 rounded-lg text-[12px] font-semibold transition-all duration-150 cursor-pointer"
              style={{
                padding: '5px 0',
                background: active ? '#C9A96E' : '#F4F1EC',
                color:      active ? '#fff'    : '#B0A99F',
                border:     active ? '1.5px solid #C9A96E' : '1.5px solid transparent',
                boxShadow:  active ? '0 2px 6px rgba(201,169,110,0.35)' : 'none',
              }}
            >
              {n}
            </button>
          )
        })}
      </div>

      <div
        className="text-[13px] font-bold text-center shrink-0"
        style={{ minWidth: 46, color: value > 0 ? '#C9A96E' : '#D1C9BE' }}
      >
        {value === 0 ? 'なし' : `${value}回`}
      </div>
    </div>
  )
}
