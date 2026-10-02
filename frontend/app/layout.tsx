import type { Metadata, Viewport } from 'next'
import Providers from './providers'
import './styles.css'

const khmerFontsUrl = 'https://fonts.googleapis.com/css2?family=Battambang:wght@400;700&family=Bokor&family=Chenla&family=Content&family=Hanuman:wght@400;700&family=Koulen&family=Moul&family=Siemreap&display=swap';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export const metadata: Metadata = {
  title: 'Wattaman',
  description: 'Modern school attendance management system',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.svg',
    apple: '/logo.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#00C9A7" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href={khmerFontsUrl} rel="stylesheet" />
      </head>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
