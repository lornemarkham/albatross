import { WWMark } from './BrandLogos'

export function LocalFocus() {
  return (
    <section id="local" className="border-t border-teal-200/60 bg-gradient-to-b from-teal-50 to-cyan-50 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-5 text-center sm:px-8">
        <WWMark className="mx-auto h-14 w-14 opacity-90" />
        <p className="font-display mt-8 text-xl font-bold text-slate-900 sm:text-2xl">
          Proudly built for Kalamalka Lake &amp; Coldstream
        </p>
        <p className="mt-4 text-[15px] leading-relaxed text-slate-600">
          One lake, one trusted pub partner, and a delivery model that respects local rules, the
          water, and the way people actually spend July and August here.
        </p>
      </div>
    </section>
  )
}
