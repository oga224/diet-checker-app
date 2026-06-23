export default function WelcomeScreen({ onStart }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-between px-6 py-10 relative overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #111B38 0%, #1C2951 50%, #172244 100%)' }}
    >
      {/* 装飾グロー */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(201,169,110,0.12) 0%, transparent 70%)', top: '-60px' }}
        />
        <div
          className="absolute bottom-0 right-0 w-64 h-64 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(196,137,123,0.08) 0%, transparent 70%)' }}
        />
      </div>

      {/* 上部 */}
      <div className="w-full flex flex-col items-center pt-4 relative animate-fade-up">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-px w-8" style={{ background: 'linear-gradient(90deg, transparent, #C9A96E)' }} />
          <p className="text-[10px] font-medium tracking-[0.3em]" style={{ color: '#C9A96E' }}>
            BODY & MONEY DIAGNOSIS
          </p>
          <div className="h-px w-8" style={{ background: 'linear-gradient(90deg, #C9A96E, transparent)' }} />
        </div>

        <h1 className="font-serif text-white text-center leading-tight mb-3" style={{ fontSize: '2rem', fontWeight: 300, letterSpacing: '0.04em' }}>
          あなたの体と<br />お金の見える化診断
        </h1>

        <div className="w-10 h-px mx-auto mb-6" style={{ background: 'linear-gradient(90deg, #C9A96E, #E8C98A, #C9A96E)' }} />

        <p className="text-center text-sm leading-relaxed mb-8" style={{ color: '#8A9BC0', maxWidth: 320 }}>
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
                background: 'rgba(255,255,255,0.06)',
                border:     '1px solid rgba(201,169,110,0.25)',
                color:      '#C4B89A',
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
          background: 'rgba(255,255,255,0.05)',
          border:     '1px solid rgba(201,169,110,0.2)',
          backdropFilter: 'blur(8px)',
          animationDelay: '0.1s',
        }}
      >
        <p className="text-[11px] font-bold tracking-widest mb-3" style={{ color: '#C9A96E' }}>
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
              style={{ background: 'rgba(201,169,110,0.2)', minWidth: 16 }}
            >
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#C9A96E' }} />
            </div>
            <p className="text-[12px] leading-snug" style={{ color: '#C4B89A' }}>{item}</p>
          </div>
        ))}
      </div>

      {/* CTAボタン */}
      <div className="w-full flex flex-col items-center gap-4 relative animate-fade-up" style={{ animationDelay: '0.2s', maxWidth: 400 }}>
        <button
          onClick={onStart}
          className="w-full py-5 rounded-2xl font-bold text-white text-sm tracking-widest transition-all duration-200 active:scale-[0.97]"
          style={{
            background:  'linear-gradient(135deg, #C9A96E 0%, #E8C98A 50%, #C9A96E 100%)',
            boxShadow:   '0 6px 24px rgba(201,169,110,0.45)',
            letterSpacing: '0.1em',
          }}
        >
          診断をはじめる →
        </button>
        <p className="text-[10px] text-center" style={{ color: '#4A5680' }}>
          ※ この診断は医療診断ではありません。<br />
          体調・疾患については必ず医師にご相談ください。
        </p>
      </div>
    </div>
  )
}
