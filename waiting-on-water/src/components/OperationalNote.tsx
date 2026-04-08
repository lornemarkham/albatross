export function OperationalNote() {
  return (
    <aside
      className="border-t border-slate-800/70 bg-slate-950 py-10 sm:py-12"
      aria-label="Operational and safety considerations"
    >
      <div className="mx-auto max-w-3xl px-5 sm:px-8">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Operational &amp; Safety Considerations
        </h2>
        <p className="mt-4 text-[11px] leading-relaxed text-slate-500 sm:text-xs">
          Waiting on Water is being developed with a strong focus on safe, compliant, and
          responsible operations.
        </p>
        <ul className="mt-5 space-y-2.5 text-[11px] leading-relaxed text-slate-500 sm:text-xs">
          <li className="flex gap-2.5">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-600" aria-hidden />
            <span>
              All food is transported sealed and handled according to food safety best practices
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-600" aria-hidden />
            <span>Dedicated cooler systems are used for food-only transport</span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-600" aria-hidden />
            <span>
              Drivers will follow structured operating procedures and maintain delivery logs
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-600" aria-hidden />
            <span>
              Alcohol delivery (where permitted) will follow all applicable regulations, including
              ID verification
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-600" aria-hidden />
            <span>
              Staff will be trained with appropriate certifications (e.g., Serving It Right, food
              safety)
            </span>
          </li>
        </ul>
        <p className="mt-6 text-[11px] leading-relaxed text-slate-500 sm:text-xs">
          This concept is being built in consultation with health &amp; safety and regulatory
          considerations to ensure a responsible and scalable model.
        </p>
      </div>
    </aside>
  )
}
