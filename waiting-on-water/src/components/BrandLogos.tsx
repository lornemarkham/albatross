type WWProps = {
  className?: string
  /** When false, logo is announced (e.g. hero). When true, hidden from AT (decorative repeat). */
  decorative?: boolean
}

export function WWMark({ className = '', decorative = true }: WWProps) {
  return (
    <img
      src="/ww-logo.svg"
      alt={decorative ? '' : 'Waiting on Water'}
      aria-hidden={decorative}
      className={className}
    />
  )
}
