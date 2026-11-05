'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from './Providers';
import { Icon } from './Icon';

const NAV = [
  { href: '/', label: '홈', icon: 'home' as const, match: (p: string) => p === '/' || p.startsWith('/world') },
  { href: '/posts', label: '게시판', icon: 'board' as const, match: (p: string) => p.startsWith('/posts') },
  { href: '/matches', label: '매칭', icon: 'match' as const, match: (p: string) => p.startsWith('/matches') },
  { href: '/trades', label: '거래', icon: 'trade' as const, match: (p: string) => p.startsWith('/trades') },
  { href: '/me', label: 'MY', icon: 'me' as const, match: (p: string) => p.startsWith('/me') || p.startsWith('/settings') || p.startsWith('/notifications') },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const { me, configured } = useApp();
  const unread = me?.unread_notifications ?? 0;
  const actions = me?.action_needed ?? 0;

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="프리나눔 홈">
          <span aria-hidden>🌱</span> 프리나눔
        </Link>
        <span className="spacer" />
        {me?.role === 'admin' && (
          <Link href="/admin" className="icon-btn" aria-label="운영자">
            <Icon name="shield" />
          </Link>
        )}
        <Link href="/help" className="icon-btn" aria-label="도움말·안내">
          <Icon name="help" />
        </Link>
        <Link href="/notifications" className="icon-btn" aria-label={`알림${unread ? ` ${unread}개 안 읽음` : ''}`}>
          <Icon name="bell" />
          {unread > 0 && <span className="dot">{unread > 99 ? '99+' : unread}</span>}
        </Link>
      </header>
      {!configured && (
        <div className="notice warn" style={{ margin: '12px 16px 0' }}>
          서버 연결 설정(NEXT_PUBLIC_SUPABASE_URL / ANON_KEY)이 없어 화면만 보여요.
        </div>
      )}
      <main className="content" id="main">
        {children}
      </main>
      <nav className="bottomnav" aria-label="주요 메뉴">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} aria-current={n.match(pathname) ? 'page' : undefined}>
            <Icon name={n.icon} />
            {n.label}
            {n.href === '/trades' && actions > 0 && <span className="dot">{actions}</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}
