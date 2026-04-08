import { WWMark } from './BrandLogos'

/**
 * Wakeboarding behind a boat — turquoise water, BC lake. Action, summer energy.
 * Not underwater / scuba imagery.
 */
const HERO_IMAGE =
  'https://images.unsplash.com/photo-1758928265499-8c062e7ec484?auto=format&fit=crop&w=2400&q=85'

export function Hero() {
  return (
    <section
      id="top"
      className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-5 pb-20 pt-28 text-center sm:px-8 sm:pb-28 sm:pt-32"
    >
      <div
        className="absolute inset-0 bg-cover bg-[center_42%]"
        style={{ backgroundImage: `url(${HERO_IMAGE})` }}
        aria-hidden
      />
      <div className="absolute inset-0 bg-hero-lake" />
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_90%_70%_at_50%_20%,rgba(15,23,42,0.35),transparent_60%)]"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center">
        <div className="animate-fade-up drop-shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
          <div className="animate-float-soft rounded-[2rem] bg-white/10 p-6 ring-1 ring-white/20 backdrop-blur-sm sm:p-8">
            <WWMark
              decorative={false}
              className="mx-auto h-24 w-24 sm:h-32 sm:w-32 md:h-36 md:w-36"
            />
          </div>
        </div>

        <h1 className="font-display animate-fade-up animate-delay-1 mt-10 max-w-3xl text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl md:text-6xl lg:text-7xl">
          Sit. Surf. Get Served.
        </h1>

        <p className="animate-fade-up animate-delay-1 mt-5 max-w-2xl text-lg font-medium text-cyan-50 sm:text-xl md:text-2xl">
          Alexander&apos;s Pub — delivered directly to your boat on Kalamalka Lake.
        </p>

        <p className="animate-fade-up animate-delay-2 mt-4 max-w-xl text-base leading-relaxed text-slate-200/95 sm:text-lg">
          Hot food and cold drinks delivered anywhere on the lake
        </p>

        <div className="animate-fade-up animate-delay-3 mt-10 flex flex-col items-center gap-4 sm:flex-row">
          <a
            href="#opportunity"
            className="inline-flex min-w-[220px] items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 to-teal-500 px-10 py-4 text-base font-bold text-slate-950 shadow-lg shadow-cyan-500/25 transition hover:brightness-110 hover:shadow-cyan-400/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
          >
            Launching Summer 2026
          </a>
          <span className="text-sm font-medium text-cyan-100/90">
            New revenue for Alexander&apos;s Pub · Sea-Doo delivery
          </span>
        </div>
      </div>
    </section>
  )
}
