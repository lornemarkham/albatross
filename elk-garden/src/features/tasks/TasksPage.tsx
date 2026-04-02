import { SectionContainer } from '../../components/SectionContainer'
import { TaskList } from '../../components/TaskList'
import { GardenModeSelector } from '../../components/GardenModeSelector'
import { useGarden } from '../../lib/useGarden'

export function TasksPage() {
  const { garden, isLoading, error, toggleTask, gardenMode, setGardenMode } =
    useGarden()

  if (isLoading) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <p className="text-base font-semibold text-stone-900">Loading tasks…</p>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">
            One moment.
          </p>
        </div>
      </div>
    )
  }

  if (error || !garden) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <p className="text-base font-semibold text-stone-900">
            We couldn’t load tasks
          </p>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">
            {error ?? 'Please try again.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-4">
      <SectionContainer
        title="Tasks"
        subtitle="A calm checklist — complete what you can, when you can."
      >
        <TaskList items={garden.tasks} onToggle={toggleTask} />
      </SectionContainer>

      <SectionContainer
        title="Garden mode"
        subtitle="Pick what you want the app to optimize for."
      >
        <GardenModeSelector value={gardenMode} onChange={setGardenMode} />
      </SectionContainer>
    </div>
  )
}

