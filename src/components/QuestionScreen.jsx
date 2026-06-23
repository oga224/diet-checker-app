import { useState, useEffect } from 'react'
import { QUESTIONS } from '../data/questions'

function ProgressBar({ current, total }) {
  const pct = ((current + 1) / total) * 100
  return (
    <div className="relative">
      <div className="w-full h-1 rounded-full" style={{ background: '#EDE8E0' }}>
        <div
          className="h-1 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #C9A96E, #E8C98A)' }}
        />
      </div>
      <p className="text-right text-[10px] mt-1.5" style={{ color: '#B0A99F' }}>
        {current + 1} / {total}
      </p>
    </div>
  )
}

export default function QuestionScreen({ step, answers, onAnswer, onBack }) {
  const q         = QUESTIONS[step]
  const selected  = answers[q.id]
  const [pending, setPending] = useState(null) // 選択済み（アニメーション中）
  const [animKey, setAnimKey] = useState(0)

  useEffect(() => {
    setPending(null)
    setAnimKey((k) => k + 1)
  }, [step])

  const handleSelect = (value) => {
    if (pending !== null) return
    setPending(value)
    setTimeout(() => onAnswer(q.id, value), 480)
  }

  const lines = q.question.split('\n')

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#F5F2EE' }}>
      {/* ヘッダー */}
      <div className="px-5 pt-5 pb-3" style={{ background: 'white', borderBottom: '1px solid #EDE8E0' }}>
        <ProgressBar current={step} total={QUESTIONS.length} />
      </div>

      {/* 質問エリア */}
      <div key={animKey} className="flex-1 flex flex-col px-5 pt-6 pb-4 animate-slide-in" style={{ maxWidth: 520, width: '100%', margin: '0 auto' }}>
        {/* カテゴリバッジ */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">{q.icon}</span>
          <span
            className="text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full"
            style={{ background: '#FEF3DC', color: '#C9A96E', border: '1px solid #F0E4C8' }}
          >
            {q.category}
          </span>
        </div>

        {/* 質問文 */}
        <div className="mb-2">
          {lines.map((line, i) => (
            <p
              key={i}
              className="font-medium leading-snug"
              style={{ fontSize: '1.15rem', color: '#1C2951', lineHeight: 1.55 }}
            >
              {line}
            </p>
          ))}
        </div>

        {/* ヒント */}
        <p className="text-[11px] mb-6 leading-relaxed" style={{ color: '#B0A99F' }}>
          {q.hint}
        </p>

        {/* 選択肢 */}
        <div className="flex flex-col gap-3 flex-1">
          {q.options.map((opt) => {
            const isSelected = pending !== null ? pending === opt.value : selected === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => handleSelect(opt.value)}
                className="w-full text-left rounded-2xl px-5 transition-all duration-200 active:scale-[0.98]"
                style={{
                  paddingTop:    18,
                  paddingBottom: 18,
                  background: isSelected
                    ? 'linear-gradient(135deg, #1C2951 0%, #2D3E6E 100%)'
                    : 'white',
                  border: isSelected
                    ? '1.5px solid #1C2951'
                    : '1.5px solid #EDE8E0',
                  boxShadow: isSelected
                    ? '0 4px 16px rgba(28,41,81,0.2)'
                    : '0 1px 4px rgba(0,0,0,0.04)',
                  cursor: pending !== null ? 'default' : 'pointer',
                }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p
                      className="font-semibold text-sm"
                      style={{ color: isSelected ? 'white' : '#1C2951' }}
                    >
                      {opt.label}
                    </p>
                    {opt.sub && (
                      <p
                        className="text-[11px] mt-0.5"
                        style={{ color: isSelected ? 'rgba(255,255,255,0.6)' : '#B0A99F' }}
                      >
                        {opt.sub}
                      </p>
                    )}
                  </div>
                  <div
                    className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ml-3"
                    style={{
                      borderColor: isSelected ? '#C9A96E' : '#DDD8D0',
                      background:  isSelected ? '#C9A96E'  : 'transparent',
                    }}
                  >
                    {isSelected && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* 戻るボタン */}
      <div className="px-5 pb-8 pt-2" style={{ maxWidth: 520, width: '100%', margin: '0 auto' }}>
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm py-2 px-3 rounded-xl transition-all duration-150 active:scale-[0.97]"
          style={{ color: '#B0A99F', background: 'transparent' }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 11L5 7L9 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          前の質問に戻る
        </button>
      </div>
    </div>
  )
}
