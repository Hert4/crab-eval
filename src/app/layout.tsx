import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import './globals.css'
import { Sidebar } from '@/components/layout/Sidebar'
import { Toaster } from '@/components/ui/sonner'

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-geist', weight: ['300', '400', '500', '600', '700'] })

export const metadata: Metadata = {
  title: 'Crab Eval',
  description: 'LLM Evaluation Framework',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={dmSans.variable} suppressHydrationWarning>
      <body className="h-screen overflow-hidden bg-[var(--crab-bg)] font-sans antialiased text-[var(--crab-text)]" suppressHydrationWarning>
        <div className="flex h-screen">
          <Sidebar />
          <main className="flex-1 min-w-0 overflow-auto" suppressHydrationWarning>
            {children}
          </main>
        </div>
        <Toaster position="bottom-right" />
      </body>
    </html>
  )
}
