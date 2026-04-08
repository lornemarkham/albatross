import { WWMark } from './BrandLogos'

const perks = [
  {
    title: 'No docking',
    copy: 'Stay where you are — we come alongside.',
  },
  {
    title: 'No waiting in line',
    copy: 'Skip the crowd when the pub patio is packed.',
  },
  {
    title: 'Stay on the water',
    copy: 'Keep the raft, the swim, and the afternoon going.',
  },
  {
    title: 'Fast Sea-Doo delivery',
    copy: 'Short runs, clear radio or text, handoff at your boat.',
  },
]

export function CustomerExperience() {
  return (
    <section id="experience" className="relative bg-band-deep py-24 text-white sm:py-32">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(34,211,238,0.12),transparent_50%)]" />
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <WWMark className="h-11 w-11 rounded-lg opacity-95 ring-1 ring-white/15" />
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200/90">
              The experience
            </p>
            <h2 className="font-display mt-1 text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              The lake day you already love — with lunch solved
            </h2>
          </div>
        </div>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-cyan-50/90">
          Real boats, real water, real hunger. Delivery that fits the pace of summer — not an app
          gimmick.
        </p>

        <div className="mt-12 grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/40 shadow-2xl shadow-black/30 ring-1 ring-cyan-400/20">
            <img
              src="/seadoo-delivery.svg"
              alt="Sea-Doo delivery on the lake"
              className="h-auto w-full"
              width={640}
              height={360}
            />
            <p className="border-t border-white/10 px-5 py-3 text-center text-xs font-medium uppercase tracking-widest text-cyan-200/80">
              Sea-Doo delivery · Kalamalka Lake
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {perks.map((p) => (
              <article
                key={p.title}
                className="card-lift rounded-2xl border border-white/10 bg-white/[0.06] p-6 backdrop-blur-sm"
              >
                <h3 className="font-display text-lg font-bold text-white">{p.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-cyan-50/85">{p.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
