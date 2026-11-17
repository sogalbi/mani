'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { LoginRequired, Loading, PageHeader } from '@/components/ui';
import { useApp } from '@/components/Providers';
import { AuditTab, MembersTab, OverviewTab, ReportsTab, SettingsTab, ThreadsTab, TradesTab } from './parts';

const TABS = [
  ['overview', '개요', OverviewTab],
  ['reports', '신고', ReportsTab],
  ['trades', '거래', TradesTab],
  ['members', '회원', MembersTab],
  ['threads', '스레드', ThreadsTab],
  ['settings', '설정', SettingsTab],
  ['audit', '감사로그', AuditTab],
] as const;

function AdminConsole() {
  const router = useRouter();
  const pathname = usePathname() ?? '/admin';
  const params = useSearchParams();
  const current = TABS.find((t) => t[0] === params.get('tab')) ?? TABS[0];
  const Tab = current[2];

  return (
    <div className="stack">
      <PageHeader title="운영자" />
      <p className="notice small">운영자 화면에서도 바코드 원문은 볼 수 없어요. 모든 처리는 사유와 함께 감사로그에 남아요.</p>
      <div className="chips" role="tablist" aria-label="운영 메뉴">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            className="chip"
            aria-selected={current[0] === key}
            aria-pressed={current[0] === key}
            onClick={() => router.replace(`${pathname}?tab=${key}`, { scroll: false })}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={current[1]}>
        <Tab />
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { ready, session, me } = useApp();
  if (!ready || (session && !me)) return <Loading />;
  if (!session) return <LoginRequired message="운영자 계정으로 로그인해 주세요." />;
  if (me?.role !== 'admin') {
    return (
      <div className="card stack">
        <h1>운영자만 볼 수 있어요</h1>
        <p className="muted small">운영자 권한이 있는 계정으로 로그인해 주세요.</p>
      </div>
    );
  }
  return (
    <Suspense fallback={<Loading />}>
      <AdminConsole />
    </Suspense>
  );
}
