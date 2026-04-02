import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { ZonesPage } from './features/zones/ZonesPage'
import { TasksPage } from './features/tasks/TasksPage'
import { ZoneDetailPage } from './features/zones/ZoneDetailPage'
import { SetupFlowPage } from './features/setup/SetupFlowPage'
import { useGarden } from './lib/useGarden'

export default function App() {
  const location = useLocation()
  const { profile, isLoading } = useGarden()

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-stone-50">
        <div className="mx-auto max-w-xl px-4 py-10">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
            <p className="text-base font-semibold text-stone-900">
              Getting ELK Garden ready…
            </p>
            <p className="mt-2 text-base leading-relaxed text-stone-700">
              One moment.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const needsSetup = !profile?.completedAtISO
  const isInSetup = location.pathname.startsWith('/setup')

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <Navigate to={needsSetup ? '/setup' : '/dashboard'} replace />
          }
        />
        <Route path="/setup" element={<SetupFlowPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/zones" element={<ZonesPage />} />
        <Route path="/zones/:zoneId" element={<ZoneDetailPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route
          path="*"
          element={
            <Navigate to={needsSetup && !isInSetup ? '/setup' : '/dashboard'} replace />
          }
        />
      </Route>
    </Routes>
  )
}
