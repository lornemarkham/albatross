import { WWMark } from './BrandLogos'

export function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-slate-950/75 backdrop-blur-lg">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
        <a href="#top" className="group flex shrink-0 items-center gap-3">
          <WWMark className="h-10 w-10 rounded-xl shadow-lg shadow-cyan-500/15 ring-1 ring-white/10 transition group-hover:ring-cyan-400/40" />
          <div className="flex flex-col leading-tight">
            <span className="font-display text-base font-bold tracking-tight text-white sm:text-lg">
              Waiting on Water
            </span>
            <span className="hidden text-[11px] font-medium uppercase tracking-widest text-cyan-200/80 sm:block">
              Kalamalka Lake · Coldstream
            </span>
          </div>
        </a>
        <nav className="flex max-w-[52%] shrink-0 flex-wrap justify-end gap-x-3 gap-y-1 text-[11px] font-semibold text-cyan-100/90 sm:max-w-none sm:gap-7 sm:text-sm">
          <a href="#opportunity" className="transition hover:text-white">
            <span className="sm:hidden">Why</span>
            <span className="hidden sm:inline">Opportunity</span>
          </a>
          <a href="#how" className="transition hover:text-white">
            How
          </a>
          <a href="#experience" className="transition hover:text-white">
            <span className="sm:hidden">Lake</span>
            <span className="hidden sm:inline">Experience</span>
          </a>
          <a href="#menu" className="transition hover:text-white">
            Menu
          </a>
          <a href="#local" className="hidden transition hover:text-white sm:inline">
            Local
          </a>
        </nav>
      </div>
    </header>
  )
}
