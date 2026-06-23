export default function WelcomeScreen({ onStart }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-between px-6 py-10 relative overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #FFF0F4 0%, #FFFFFF 55%, #FFF5F0 100%)' }}
    >
      {/* 装飾グロー */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(212,135,138,0.14) 0%, transparent 70%)', top: '-60px' }}
        />
        <div
          className="absolute bottom-0 right-0 w-64 h-64 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(232,160,176,0.12) 0%, transparent 70%)' }}
        />
        <div
          className="absolute bottom-0 left-0 w-48 h-48 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(212,135,138,0.08) 0%, transparent 70%)' }}
        />
      </div>

      {/* 上部 */}
      <div className="w-full flex flex-col items-center pt-4 relative animate-fade-up">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-px w-8" style={{ background: 'linear-gradient(90deg, transparent, #C4778A)' }} />
          <p className="text-[10px] font-medium tracking-[0.3em]" style={{ color: '#C4778A' }}>
            BODY & MONEY DIAGNOSIS
          </p>
          <div className="h-px w-8" style={{ background: 'linear-gradient(90deg, #C4778A, transparent)' }} />
        </div>

        <h1 className="font-serif text-center leading-tight mb-3" style={{ fontSize: '2rem', fontWeight: 300, letterSpacing: '0.04em', color: '#2D1F2D' }}>
          あなたの体と<br />お金の見える化診断
        </h1>

        <div className="w-10 h-px mx-auto mb-6" style={{ background: 'linear-gradient(90deg, #E8A0B0, #F2C5D0, #E8A0B0)' }} />

        <p className="text-center text-sm leading-relaxed mb-8" style={{ color: '#9B7585', maxWidth: 320 }}>
          今の生活習慣が、体型とお金に<br />
          どんな影響を与えているかを<br />
          一緒に確認してみましょう。
        </p>

        {/* 特徴バッジ */}
        <div className="flex gap-3 flex-wrap justify-center mb-10">
          {[
            { icon: '⏱', text: '約60秒' },
            { icon: '👆', text: 'タップのみ' },
            { icon: '🔒', text: '医療診断ではありません' },
          ].map(({ icon, text }) => (
            <div
              key={text}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px]"
              style={{
                background: 'rgba(255,255,255,0.8)',
                border:     '1px solid rgba(196,119,138,0.3)',
                color:      '#9B7585',
              }}
            >
              <span>{icon}</span>
              <span>{text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 中央カード */}
      <div
        className="w-full rounded-2xl p-6 relative animate-fade-up"
        style={{
          maxWidth: 400,
          background: 'rgba(255,255,255,0.85)',
          border:     '1px solid rgba(196,119,138,0.2)',
          boxShadow:  '0 4px 24px rgba(196,119,138,0.1)',
          backdropFilter: 'blur(8px)',
          animationDelay: '0.1s',
        }}
      >
        <p className="text-[11px] font-bold tracking-widest mb-3" style={{ color: '#C4778A' }}>
          この診断でわかること
        </p>
        {[
          '今の習慣に使っている月間・年間の費用',
          '食べ物・飲み物による月間の脂肪リスク',
          '体の不調にかかっている隠れたコスト',
          '体型カバーに費やしているお金と時間',
          '3ヶ月後に生まれる貯金の可能性',
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-2.5 mb-2">
            <div
              className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center mt-0.5"
              style={{ background: 'rgba(196,119,138,0.15)', minWidth: 16 }}
            >
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#C4778A' }} />
            </div>
            <p className="text-[12px] leading-snug" style={{ color: '#6B4A58' }}>{item}</p>
          </div>
        ))}
      </div>

      {/* CTAボタン */}
      <div className="w-full flex flex-col items-center gap-4 relative animate-fade-up" style={{ animationDelay: '0.2s', maxWidth: 400 }}>
        <button
          onClick={onStart}
          className="w-full py-5 rounded-2xl font-bold text-white text-sm tracking-widest transition-all duration-200 active:scale-[0.97]"
          style={{
            background:    'linear-gradient(135deg, #C4778A 0%, #E8A0B0 50%, #C4778A 100%)',
            boxShadow:     '0 6px 24px rgba(196,119,138,0.4)',
            letterSpacing: '0.1em',
          }}
        >
          診断をはじめる →
        </button>
        <p className="text-[10px] text-center" style={{ color: '#C4A8B0' }}>
          ※ この診断は医療診断ではありません。<br />
          体調・疾患については必ず医師にご相談ください。
        </p>
      </div>
    </div>
  )
}
