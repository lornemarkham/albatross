import { Leaf, ListChecks, Sprout } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { useGarden } from '../lib/useGarden'
import { gardenModeLabel } from '../lib/mode/mode'

function TopHeader() {
  const { gardenMode } = useGarden()
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-stone-50/95 backdrop-blur">
      <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-3">
          <div
            className="grid h-11 w-11 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-stone-200"
            aria-hidden="true"
          >
            <Sprout className="h-6 w-6 text-emerald-700" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold tracking-tight text-stone-900">
              ELK Garden
            </p>
            <p className="text-sm text-stone-600">
              Grow more food with less guesswork
            </p>
            <p className="mt-1 text-sm font-semibold text-stone-700">
              {gardenModeLabel(gardenMode)}
            </p>
          </div>
        </div>
      </div>
    </header>
  )
}

function NavItem({
  to,
  label,
  icon,
}: {
  to: string
  label: string
  icon: ReactNode
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          'flex w-full flex-col items-center justify-center gap-1 rounded-2xl px-3 py-4 text-sm font-semibold outline-none',
          'focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50',
          isActive
            ? 'bg-emerald-100/80 text-emerald-950 ring-1 ring-emerald-300 shadow-sm shadow-emerald-900/5 -translate-y-0.5'
            : 'text-stone-700 hover:bg-stone-100',
        )
      }
    >
      <span aria-hidden="true" className="text-stone-800">
        {icon}
      </span>
      <span>{label}</span>
    </NavLink>
  )
}

function BottomNav() {
  return (
    <nav
      className={clsx(
        'sticky bottom-0 z-20 border-t border-stone-200 bg-stone-50/95 px-3 pt-3.5 backdrop-blur',
        'shadow-[0_-14px_36px_rgba(12,10,9,0.10)]',
        'pb-[max(env(safe-area-inset-bottom),0.75rem)]',
      )}
      aria-label="Primary"
    >
      <div className="mx-auto grid max-w-xl grid-cols-3 gap-2">
        <NavItem
          to="/dashboard"
          label="Dashboard"
          icon={<Leaf className="h-5 w-5" />}
        />
        <NavItem
          to="/zones"
          label="Zones"
          icon={<Sprout className="h-5 w-5" />}
        />
        <NavItem
          to="/tasks"
          label="Tasks"
          icon={<ListChecks className="h-5 w-5" />}
        />
      </div>
    </nav>
  )
}

export function AppShell() {
  const location = useLocation()

  return (
    <div className="min-h-dvh bg-stone-50">
      <a
        href="#main"
        className={clsx(
          'sr-only focus:not-sr-only',
          'fixed left-4 top-4 z-50 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-stone-900 shadow-sm ring-1 ring-stone-200',
        )}
      >
        Skip to content
      </a>
      <TopHeader />
      <main
        id="main"
        className="mx-auto w-full max-w-xl pb-6"
        key={location.pathname}
      >
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}

