import type { ReactNode } from 'react'

export function SectionContainer({
  title,
  subtitle,
  children,
  rightSlot,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  rightSlot?: ReactNode
}) {
  return (
    <section className="px-4 pb-10 pt-1">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-stone-950">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-base leading-relaxed text-stone-700">
              {subtitle}
            </p>
          ) : null}
        </div>
        {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
      </div>
      {children}
    </section>
  )
}

