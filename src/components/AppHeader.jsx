export default function AppHeader() {
  return (
    <header
      className="relative overflow-hidden text-center"
      style={{ background: 'linear-gradient(160deg, #1C2951 0%, #243261 70%, #1E2E55 100%)' }}
    >
      {/* Gold radial glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at 50% -10%, rgba(201,169,110,0.14) 0%, transparent 65%)' }}
      />

      <div className="relative py-12 px-6">
        <p
          className="text-[10px] font-medium mb-4"
          style={{ letterSpacing: '0.28em', color: '#C9A96E' }}
        >
          DIET COUNSELING TOOL
        </p>

        <h1
          className="font-serif text-[2.4rem] font-light text-white leading-tight mb-3"
          style={{ letterSpacing: '0.02em' }}
        >
          習慣チェッカー
        </h1>

        <p className="text-sm" style={{ color: '#8A9BC0', letterSpacing: '0.06em' }}>
          あなたの「太る習慣」を可視化する
        </p>

        <div
          className="w-9 h-0.5 mx-auto mt-5 rounded-sm"
          style={{ background: 'linear-gradient(90deg, #C9A96E, #E8C98A, #C9A96E)' }}
        />
      </div>
    </header>
  )
}
