import { Link } from 'react-router-dom'

/**
 * 戻るボタン（大きな丸ボタン + テキストラベル）
 * Props:
 *   to      - Link先URL（指定時はLinkタグ）
 *   onClick - クリックハンドラ（toがない場合に使用）
 *   label   - ボタン右のテキスト（デフォルト: "戻る"）
 *   variant - 'light'（青背景用・白） | 'dark'（白背景用・グレー）
 */
export default function BackButton({ to, onClick, label = '戻る', variant = 'light' }) {
  const isLight = variant === 'light'

  const circleClass = isLight
    ? 'bg-white/20 hover:bg-white/30 text-white'
    : 'bg-gray-100 hover:bg-gray-200 text-gray-600'

  const labelClass = isLight
    ? 'text-white font-medium text-sm'
    : 'text-gray-600 font-medium text-sm'

  const inner = (
    <span className="flex items-center gap-2">
      <span className={`w-12 h-12 rounded-full flex items-center justify-center shadow-md transition-all active:scale-95 ${circleClass}`}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </span>
      {label && <span className={labelClass}>{label}</span>}
    </span>
  )

  if (to) {
    return <Link to={to} className="flex items-center">{inner}</Link>
  }
  return (
    <button type="button" onClick={onClick} className="flex items-center">
      {inner}
    </button>
  )
}
