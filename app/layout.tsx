import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'

export const metadata: Metadata = {
  title: 'Treasury Risk Intelligence Engine — Hello Tractor',
  description: 'Live treasury risk command centre',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
        <Sidebar />
        <main style={{ flex: 1, marginLeft: '220px', minHeight: '100vh', overflow: 'auto' }}>
          {children}
        </main>
      </body>
    </html>
  )
}
