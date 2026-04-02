import clsx from 'clsx'
import type { ReactNode } from 'react'

export function Card({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={clsx(
        'rounded-2xl bg-white shadow-sm ring-1 ring-stone-200',
        className,
      )}
    >
      {children}
    </div>
  )
}

