'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEvalSessionStore } from '@/store/evalSessionStore'
import { CrabLogo } from './CrabLogo'
import {
  Database,
  Wand2,
  Settings,
  Play,
  Trophy,
  Layers,
} from 'lucide-react'

// Wrap CrabLogo to match Lucide icon interface (size prop)
function CrabIcon({ size = 15 }: { size?: number; strokeWidth?: number }) {
  return <CrabLogo size={size} />
}

const NAV = [
  { href: '/datasets',        label: 'Datasets',        icon: Database },
  { href: '/gt-generator',    label: 'GT Generator',    icon: Wand2 },
  { href: '/agents',          label: 'Agents',          icon: CrabIcon },
  { href: '/config',          label: 'Config',          icon: Settings },
  { href: '/run',             label: 'Run Eval',        icon: Play },
  { href: '/task-generator',  label: 'Task Generator',  icon: Layers },
  { href: '/leaderboard',     label: 'Leaderboard',     icon: Trophy },
]

export function Sidebar() {
  const pathname = usePathname()
  const { isRunning: evalRunning, overallProgress } = useEvalSessionStore()

  return (
    <aside className="w-56 shrink-0 border-r border-[var(--crab-border)] bg-[var(--crab-bg-secondary)] flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="h-14 flex items-center px-5 border-b border-[var(--crab-border)]">
        <div className="flex items-center gap-2.5">
          <CrabLogo size={22} />
          <span className="font-semibold text-[15px] text-[var(--crab-text)] tracking-tight">
            Crab Eval
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          const isRunPage = href === '/run'
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] font-medium transition-colors ${
                active
                  ? 'bg-[var(--crab-accent-light)] text-[var(--crab-accent)]'
                  : 'text-[var(--crab-text-muted)] hover:bg-[var(--crab-bg-hover)] hover:text-[var(--crab-text)]'
              }`}
            >
              <Icon size={15} strokeWidth={active ? 2.2 : 1.8} />
              <span className="flex-1">{label}</span>
              {isRunPage && evalRunning && (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--crab-accent)] animate-pulse" />
                  <span className="text-[10px] text-[var(--crab-accent)] font-mono">{overallProgress}%</span>
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-[var(--crab-border)]">
        <p className="text-[11px] text-[var(--crab-text-muted)]">
          Data in localStorage
        </p>
      </div>
    </aside>
  )
}
