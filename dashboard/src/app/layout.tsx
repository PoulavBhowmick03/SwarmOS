import type { Metadata } from 'next'
import { JetBrains_Mono } from 'next/font/google'
import './globals.css'

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight:  ['400', '500', '600', '700'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title:       'SwarmOS',
  description: 'Darwinian AI agent swarm — live on Solana devnet',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={mono.variable}>
      <body
        style={{
          margin:     0,
          padding:    0,
          background: '#0a0a0a',
          color:      '#e8e8e4',
          fontFamily: 'var(--font-mono, monospace)',
          height:     '100vh',
          overflow:   'hidden',
        }}
      >
        {children}
      </body>
    </html>
  )
}
