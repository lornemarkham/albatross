import { WWMark } from './BrandLogos'

export function Footer() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950 py-16">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 sm:flex-row sm:items-start sm:justify-between sm:px-8">
        <div className="flex gap-4">
          <WWMark className="h-12 w-12 shrink-0" />
          <div>
            <p className="font-display text-lg font-bold text-white">Waiting on Water</p>
            <p className="mt-2 text-sm text-slate-400">Pilot concept for Alexander&apos;s Pub</p>
            <p className="mt-1 text-sm font-semibold text-cyan-400/90">Summer 2026</p>
          </div>
        </div>
        <div className="text-sm">
          <p className="font-medium text-white">Let&apos;s talk</p>
          <a
            href="mailto:hello@waitingonwater.ca"
            className="mt-2 inline-block text-cyan-300/90 underline decoration-cyan-500/40 underline-offset-2 transition hover:text-white"
          >
            hello@waitingonwater.ca
          </a>
          <p className="mt-6 text-xs text-slate-500">
            © {new Date().getFullYear()} Waiting on Water · Kalamalka Lake, BC
          </p>
        </div>
      </div>
    </footer>
  )
}
