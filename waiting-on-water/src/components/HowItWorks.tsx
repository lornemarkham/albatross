const steps = [
  {
    title: "Order from Alexander's Pub",
    body: 'Guests order the pub menu — same burgers, sides, and drinks — for pickup toward the boat.',
  },
  {
    title: 'We pick it up fresh and sealed',
    body: "We grab it when the kitchen says it's ready, bagged for a short run across the lake.",
  },
  {
    title: 'Delivered by Sea-Doo directly to your boat',
    body: 'We meet you on Kalamalka at your location — handoff on the water, no dock required.',
  },
]

export function HowItWorks() {
  return (
    <section id="how" className="border-t border-slate-200 bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-600">How it works</p>
          <h2 className="font-display mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Three steps from kitchen to cooler
          </h2>
        </div>

        <ol className="mt-14 grid gap-8 md:grid-cols-3">
          {steps.map((step, i) => (
            <li
              key={step.title}
              className="card-lift relative rounded-2xl border border-slate-200 bg-slate-50/80 p-8"
            >
              <span className="font-display absolute right-6 top-6 text-4xl font-extrabold text-teal-100">
                {i + 1}
              </span>
              <h3 className="font-display pr-12 text-lg font-bold text-slate-900">{step.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
