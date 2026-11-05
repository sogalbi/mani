import type { Metadata, Viewport } from 'next';
import Providers from '@/components/Providers';
import AppShell from '@/components/AppShell';
import './globals.css';

const site = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: '프리나눔 · 프리퀀시 무료 나눔·교환', template: '%s · 프리나눔' },
  description: '남는 한 장이 누군가에게는 마지막 한 장. e-프리퀀시 스티커 무료 나눔과 교환을 이어 주는 작은 동화 마을.',
  applicationName: '프리나눔',
  openGraph: { siteName: '프리나눔', locale: 'ko_KR', type: 'website' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbf6ea' },
    { media: '(prefers-color-scheme: dark)', color: '#1f1d19' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Gowun+Dodum&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
