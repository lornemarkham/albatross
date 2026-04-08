import { WWMark } from './BrandLogos'

const points = [
  {
    title: 'Serve customers who never dock',
    body: 'Boats full of hungry guests — they want your food without tying up at the marina.',
  },
  {
    title: 'Increase food sales during peak lake hours',
    body: 'When the deck is slammed, the lake is still full of orders waiting to happen.',
  },
  {
    title: "Extend Alexander's Pub onto the water",
    body: 'Same kitchen, same menu — a second service lane that meets people where they float.',
  },
  {
    title: 'Premium delivery experience',
    body: 'Sea-Doo handoffs feel personal: quick, visible, and built for Kalamalka.',
  },
]

export function TheOpportunity() {
  return (
    <section id="opportunity" className="relative border-t border-teal-200/70 bg-band-teal py-24 sm:py-32">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-700">The opportunity</p>
            <h2 className="font-display mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl md:text-5xl">
              A Second Location — Without the Overhead
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-slate-600">
              Waiting on Water turns lake traffic into off-premise sales — no new building, no extra
              seats, just more tickets from people already out on the water.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-teal-200/80 bg-white/80 px-5 py-4 shadow-sm shadow-teal-900/5 backdrop-blur-sm">
            <WWMark className="h-12 w-12 shrink-0" />
            <div>
              <p className="text-sm font-bold text-slate-900">Waiting on Water</p>
              <p className="text-xs text-slate-600">Pilot · Summer 2026</p>
            </div>
          </div>
        </div>

        <ul className="mt-16 grid gap-6 sm:grid-cols-2">
          {points.map((p) => (
            <li
              key={p.title}
              className="card-lift rounded-2xl border border-teal-100/90 bg-white/90 p-7 shadow-md shadow-teal-900/5"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-teal-600 text-sm font-bold text-white shadow-md shadow-teal-600/25">
                ✓
              </div>
              <h3 className="font-display mt-6 text-lg font-bold text-slate-900">{p.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{p.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
