import { WWMark } from './BrandLogos'

const items = [
  {
    title: 'Pub meals',
    blurb: 'Burgers, fries, sandwiches, and pub favourites — hot and packed for the boat.',
  },
  {
    title: 'Cold drinks',
    blurb: 'Soft drinks, iced tea, water — cold for the ride out.',
  },
  {
    title: 'Packaged alcohol',
    blurb: 'Beer, cider, wine where permitted — ID at delivery, rules followed.',
  },
]

export function WhatYouCanOrder() {
  return (
    <section id="menu" className="border-t border-slate-200 bg-slate-50 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex flex-col items-center text-center">
          <WWMark className="h-14 w-14 opacity-95 sm:h-16 sm:w-16" />
          <p className="mt-6 text-sm font-semibold uppercase tracking-[0.2em] text-teal-600">
            What you can order
          </p>
          <h2 className="font-display mt-3 max-w-2xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Straight from Alexander&apos;s Pub to your boat
          </h2>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.title}
              className="card-lift rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"
            >
              <h3 className="font-display text-lg font-bold text-slate-900">{item.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{item.blurb}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
