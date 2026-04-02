import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Card } from '../../components/Card'
import { SectionContainer } from '../../components/SectionContainer'
import type {
  CropType,
  GardenGoal,
  GardenProfile,
  InvolvementLevel,
  LayoutStyle,
} from '../../types'
import { useGarden } from '../../lib/useGarden'

type StepId = 'goal' | 'crops' | 'involvement' | 'layout'

function StepHeader({
  title,
  stepIndex,
  stepCount,
  subtitle,
}: {
  title: string
  stepIndex: number
  stepCount: number
  subtitle?: string
}) {
  return (
    <div className="px-4 pb-4 pt-4">
      <p className="text-base font-semibold text-stone-700">
        Step {stepIndex} of {stepCount}
      </p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-stone-950">
        {title}
      </p>
      {subtitle ? (
        <p className="mt-3 text-lg leading-relaxed text-stone-800">{subtitle}</p>
      ) : null}
      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-stone-200">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${(stepIndex / stepCount) * 100}%` }}
        />
      </div>
    </div>
  )
}

function SelectCard({
  title,
  description,
  selected,
  onClick,
}: {
  title: string
  description: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'w-full text-left',
        'rounded-2xl p-4 shadow-sm ring-1',
        'transition duration-200 motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50',
        selected
          ? 'bg-emerald-50/60 ring-emerald-200'
          : 'bg-white ring-stone-200 hover:bg-stone-50',
      )}
    >
      <p className="text-lg font-semibold tracking-tight text-stone-950">
        {title}
      </p>
      <p className="mt-2 text-base leading-relaxed text-stone-700">
        {description}
      </p>
    </button>
  )
}

function FooterNav({
  canGoBack,
  canGoNext,
  onBack,
  onNext,
  nextLabel = 'Next',
}: {
  canGoBack: boolean
  canGoNext: boolean
  onBack: () => void
  onNext: () => void
  nextLabel?: string
}) {
  return (
    <div className="px-4 pb-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack}
          className={clsx(
            'w-full rounded-2xl px-4 py-4 text-base font-semibold',
            canGoBack
              ? 'bg-white text-stone-900 shadow-sm ring-1 ring-stone-200 hover:bg-stone-50'
              : 'bg-stone-100 text-stone-400 ring-1 ring-stone-200',
          )}
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canGoNext}
          className={clsx(
            'w-full rounded-2xl px-4 py-4 text-base font-semibold',
            canGoNext
              ? 'bg-stone-900 text-white shadow-sm ring-1 ring-stone-900 hover:bg-stone-800'
              : 'bg-stone-200 text-stone-500 ring-1 ring-stone-200',
          )}
        >
          {nextLabel}
        </button>
      </div>
      <p className="mt-4 text-base leading-relaxed text-stone-700">
        You can change these later. This just helps ELK Garden give calmer, more
        useful guidance.
      </p>
    </div>
  )
}

export function SetupFlowPage() {
  const navigate = useNavigate()
  const { profile, saveProfile } = useGarden()

  const [step, setStep] = useState<StepId>('goal')
  const [goal, setGoal] = useState<GardenGoal | null>(profile?.goal ?? null)
  const [crops, setCrops] = useState<CropType[]>(profile?.crops ?? [])
  const [otherCrop, setOtherCrop] = useState(profile?.otherCrop ?? '')
  const [involvement, setInvolvement] = useState<InvolvementLevel | null>(
    profile?.involvement ?? null,
  )
  const [layout, setLayout] = useState<LayoutStyle | null>(
    profile?.layout ?? null,
  )

  const steps: StepId[] = useMemo(
    () => ['goal', 'crops', 'involvement', 'layout'],
    [],
  )
  const stepIndex = steps.indexOf(step) + 1

  const canGoBack = stepIndex > 1
  const goBack = () => setStep(steps[Math.max(0, stepIndex - 2)])
  const goNext = () => setStep(steps[Math.min(steps.length - 1, stepIndex)])

  const toggleCrop = (c: CropType) => {
    setCrops((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    )
  }

  const canGoNext =
    (step === 'goal' && !!goal) ||
    (step === 'crops' && crops.length > 0) ||
    (step === 'involvement' && !!involvement) ||
    (step === 'layout' && !!layout)

  const onNext = async () => {
    if (step !== 'layout') {
      goNext()
      return
    }

    const finalProfile: GardenProfile = {
      goal,
      crops,
      otherCrop: crops.includes('other') ? otherCrop.trim() : undefined,
      involvement,
      layout,
      completedAtISO: new Date().toISOString(),
    }

    await saveProfile(finalProfile)
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="pt-2">
      {step === 'goal' ? (
        <>
          <StepHeader
            title="What matters most in your garden?"
            stepIndex={1}
            stepCount={4}
            subtitle="There’s no wrong answer. We’ll use this to keep guidance supportive and practical."
          />
          <SectionContainer title="Choose one" subtitle="Pick what fits your season right now.">
            <div className="space-y-4">
              <SelectCard
                title="Grow as much food as possible"
                description="We’ll prioritize high-impact actions that protect yield and keep plants productive."
                selected={goal === 'high_yield'}
                onClick={() => setGoal('high_yield')}
              />
              <SelectCard
                title="Keep things simple and low effort"
                description="We’ll focus on the few steps that prevent problems without a lot of daily checking."
                selected={goal === 'simple_low_effort'}
                onClick={() => setGoal('simple_low_effort')}
              />
              <SelectCard
                title="A balance of beauty and food"
                description="We’ll aim for steady production while keeping the garden pleasant and enjoyable."
                selected={goal === 'beauty_and_food'}
                onClick={() => setGoal('beauty_and_food')}
              />
              <SelectCard
                title="I’m still figuring it out"
                description="We’ll keep guidance gentle and simple, with small confidence-building steps."
                selected={goal === 'figuring_it_out'}
                onClick={() => setGoal('figuring_it_out')}
              />
            </div>
          </SectionContainer>
        </>
      ) : null}

      {step === 'crops' ? (
        <>
          <StepHeader
            title="What are you planning to grow?"
            stepIndex={2}
            stepCount={4}
            subtitle="Select a few. This helps your dashboard feel more relevant."
          />
          <SectionContainer title="Pick all that apply" subtitle="You can change this anytime.">
            <div className="space-y-4">
              {(
                [
                  ['tomatoes', 'Tomatoes', 'Great yields with steady water and simple pruning.'],
                  ['greens', 'Greens', 'Consistent moisture keeps them sweet and tender.'],
                  ['root_vegetables', 'Root vegetables', 'Even moisture helps sizing and prevents cracking.'],
                  ['herbs', 'Herbs', 'Usually resilient — we’ll keep care simple.'],
                  ['melons', 'Melons', 'Love warmth, space, and careful watering timing.'],
                  ['flowers', 'Flowers', 'Supports pollinators and makes the garden feel welcoming.'],
                  ['other', 'Other', 'Add anything that doesn’t fit the list.'],
                ] as const
              ).map(([id, title, desc]) => (
                <SelectCard
                  key={id}
                  title={title}
                  description={desc}
                  selected={crops.includes(id)}
                  onClick={() => toggleCrop(id)}
                />
              ))}

              {crops.includes('other') ? (
                <Card className="bg-white p-4">
                  <label className="block text-base font-semibold text-stone-950">
                    Other (optional)
                  </label>
                  <input
                    value={otherCrop}
                    onChange={(e) => setOtherCrop(e.target.value)}
                    placeholder="Example: cucumbers, peppers, berries…"
                    className={clsx(
                      'mt-2 w-full rounded-2xl bg-stone-50 px-4 py-4 text-base text-stone-900 ring-1 ring-stone-200',
                      'focus:outline-none focus:ring-2 focus:ring-emerald-600',
                    )}
                  />
                  <p className="mt-2 text-base leading-relaxed text-stone-700">
                    Keep it simple — a few words is plenty.
                  </p>
                </Card>
              ) : null}
            </div>
          </SectionContainer>
        </>
      ) : null}

      {step === 'involvement' ? (
        <>
          <StepHeader
            title="How hands-on do you want to be?"
            stepIndex={3}
            stepCount={4}
            subtitle="We’ll match the app’s guidance to your preferred pace."
          />
          <SectionContainer title="Choose one" subtitle="This helps keep recommendations realistic.">
            <div className="space-y-4">
              <SelectCard
                title="I enjoy checking daily"
                description="We’ll give small daily wins and early gentle alerts."
                selected={involvement === 'daily'}
                onClick={() => setInvolvement('daily')}
              />
              <SelectCard
                title="A few times a week is good"
                description="We’ll focus on the best moments to check — not constant monitoring."
                selected={involvement === 'few_times_week'}
                onClick={() => setInvolvement('few_times_week')}
              />
              <SelectCard
                title="I prefer low maintenance"
                description="We’ll keep it calm and minimal: just the highest-impact steps."
                selected={involvement === 'low_maintenance'}
                onClick={() => setInvolvement('low_maintenance')}
              />
            </div>
          </SectionContainer>
        </>
      ) : null}

      {step === 'layout' ? (
        <>
          <StepHeader
            title="How is your garden set up?"
            stepIndex={4}
            stepCount={4}
            subtitle="This helps us talk about your garden in a way that feels familiar."
          />
          <SectionContainer title="Choose one" subtitle="Keep it simple — we’ll refine later if needed.">
            <div className="space-y-4">
              <SelectCard
                title="A few clear garden beds"
                description="We’ll keep guidance bed-focused and easy to follow."
                selected={layout === 'clear_beds'}
                onClick={() => setLayout('clear_beds')}
              />
              <SelectCard
                title="Mixed or shared spaces"
                description="We’ll keep recommendations flexible and easy to apply."
                selected={layout === 'mixed_spaces'}
                onClick={() => setLayout('mixed_spaces')}
              />
              <SelectCard
                title="Still planning my layout"
                description="We’ll focus on simple fundamentals and build confidence first."
                selected={layout === 'planning_layout'}
                onClick={() => setLayout('planning_layout')}
              />
            </div>
          </SectionContainer>
        </>
      ) : null}

      <FooterNav
        canGoBack={canGoBack}
        canGoNext={canGoNext}
        onBack={goBack}
        onNext={onNext}
        nextLabel={step === 'layout' ? 'Finish' : 'Next'}
      />
    </div>
  )
}

