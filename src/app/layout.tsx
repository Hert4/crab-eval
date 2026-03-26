import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { Sidebar } from '@/components/layout/Sidebar'
import { Toaster } from '@/components/ui/sonner'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })

export const metadata: Metadata = {
  title: 'Eval Studio',
  description: 'LLM Evaluation Framework',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={geist.variable}>
      <body className="h-screen overflow-hidden bg-[#F9F9F8] font-sans antialiased">
        <div className="flex h-screen">
          <Sidebar />
          <main className="flex-1 min-w-0 overflow-auto">
            {children}
          </main>
        </div>
        <Toaster position="bottom-right" />
      </body>
    </html>
  )
}
