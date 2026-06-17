import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './Providers'

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '500'],
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'arbor',
  description: 'Certified operational data infrastructure for manufacturers, suppliers, and producers.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
