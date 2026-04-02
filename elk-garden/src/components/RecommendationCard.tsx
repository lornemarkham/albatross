import { ArrowRight } from 'lucide-react'
import { Card } from './Card'
import clsx from 'clsx'

export function RecommendationCard({
  title,
  why,
  nextStep,
  expanders,
  feedback,
  onFeedback,
}: {
  title: string
  why: string
  nextStep: string
  expanders?: Array<{ title: string; body: string }>
  feedback?: 'helpful' | 'not_quite' | null
  onFeedback?: (value: 'helpful' | 'not_quite') => void
}) {
  return (
    <Card className="bg-emerald-50/45 p-3.5 ring-emerald-200 shadow-sm shadow-emerald-900/5">
      <p className="text-lg font-semibold tracking-tight text-stone-950">
        {title}
      </p>
      <p className="mt-2 text-base leading-relaxed text-stone-700">{why}</p>
      <div className="mt-3 rounded-2xl bg-white/90 p-3 ring-1 ring-emerald-200">
        <div className="mt-1 flex items-start gap-2">
        <ArrowRight className="mt-0.5 h-5 w-5 text-stone-700" aria-hidden="true" />
          <p className="text-base font-semibold leading-relaxed text-stone-950">
            {nextStep}
          </p>
        </div>
      </div>
      {expanders?.length ? (
        <div className="mt-3 space-y-2">
          {expanders.map((e) => (
            <details
              key={e.title}
              className="rounded-2xl bg-white/70 p-3 ring-1 ring-emerald-200"
            >
              <summary className="cursor-pointer text-base font-semibold text-stone-900">
                {e.title}
              </summary>
              <p className="mt-2 text-base leading-relaxed text-stone-700">
                {e.body}
              </p>
            </details>
          ))}
        </div>
      ) : null}

      {onFeedback ? (
        <div className="mt-3 border-t border-emerald-200/70 pt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onFeedback('helpful')}
              className={clsx(
                'rounded-xl px-3 py-2 text-sm font-semibold text-stone-700',
                'ring-1 ring-stone-200 bg-white/70 hover:bg-white',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-50/40',
                feedback === 'helpful' && 'ring-emerald-300 text-emerald-950',
              )}
            >
              👍 Helpful
            </button>
            <button
              type="button"
              onClick={() => onFeedback('not_quite')}
              className={clsx(
                'rounded-xl px-3 py-2 text-sm font-semibold text-stone-700',
                'ring-1 ring-stone-200 bg-white/70 hover:bg-white',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-50/40',
                feedback === 'not_quite' && 'ring-emerald-300 text-emerald-950',
              )}
            >
              👎 Not quite
            </button>
          </div>

          {feedback === 'helpful' ? (
            <p className="mt-2 text-sm leading-relaxed text-stone-600">
              Got it — we'll keep suggestions like this 👍
            </p>
          ) : null}
          {feedback === 'not_quite' ? (
            <p className="mt-2 text-sm leading-relaxed text-stone-600">
              Thanks — we'll adjust future suggestions
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

