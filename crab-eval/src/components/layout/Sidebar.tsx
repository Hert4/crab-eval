'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEvalSessionStore } from '@/store/evalSessionStore'
import { CrabLogo } from './CrabLogo'
import { Layers, Database, Settings, Play, Trophy, Wand2, Users } from 'lucide-react'

const NAV = [
  { href: '/task-generator', label: 'Task Generator', icon: Layers   },
  { href: '/datasets',       label: 'Datasets',       icon: Database },
  { href: '/gt-generator',   label: 'GT Generator',   icon: Wand2    },
  { href: '/config',         label: 'Config',         icon: Settings },
  { href: '/run',            label: 'Run Eval',       icon: Play     },
  { href: '/leaderboard',    label: 'Leaderboard',    icon: Trophy   },
  { href: '/agents',         label: 'Agents',         icon: Users    },
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
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
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
    </aside>
  )
}
