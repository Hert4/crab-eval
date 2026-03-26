'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEvalSessionStore } from '@/store/evalSessionStore'
import { useVisualEvalStore } from '@/store/visualEvalStore'
import {
  Database,
  Wand2,
  Settings,
  Play,
  Trophy,
  FlaskConical,
  MessageSquare,
} from 'lucide-react'

const NAV = [
  { href: '/datasets',     label: 'Datasets',      icon: Database },
  { href: '/gt-generator', label: 'GT Generator',  icon: Wand2 },
  { href: '/config',       label: 'Config',         icon: Settings },
  { href: '/run',          label: 'Run Eval',       icon: Play },
  { href: '/visual-eval',  label: 'Visual Eval',    icon: MessageSquare },
  { href: '/leaderboard',  label: 'Leaderboard',    icon: Trophy },
]

export function Sidebar() {
  const pathname = usePathname()
  const { isRunning: evalRunning, overallProgress } = useEvalSessionStore()
  const { isRunning: simRunning, currentTurn, maxTurns } = useVisualEvalStore()

  return (
    <aside className="w-56 shrink-0 border-r border-[#E5E5E4] bg-[#F9F9F8] flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="h-14 flex items-center px-5 border-b border-[#E5E5E4]">
        <div className="flex items-center gap-2.5">
          <FlaskConical size={18} className="text-[#D97706]" />
          <span className="font-semibold text-[15px] text-[#1A1A1A] tracking-tight">
            Eval Studio
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          const isRunPage = href === '/run'
          const isSimPage = href === '/visual-eval'
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] font-medium transition-colors ${
                active
                  ? 'bg-[#EFEFED] text-[#1A1A1A]'
                  : 'text-[#6B6B6B] hover:bg-[#EFEFED] hover:text-[#1A1A1A]'
              }`}
            >
              <Icon size={15} strokeWidth={active ? 2.2 : 1.8} />
              <span className="flex-1">{label}</span>
              {isRunPage && evalRunning && (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span className="text-[10px] text-amber-600 font-mono">{overallProgress}%</span>
                </span>
              )}
              {isSimPage && simRunning && (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] text-emerald-600 font-mono">{currentTurn}/{maxTurns}</span>
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-[#E5E5E4]">
        <p className="text-[11px] text-[#9B9B9B]">
          Data in localStorage
        </p>
      </div>
    </aside>
  )
}
