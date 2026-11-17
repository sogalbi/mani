'use client';

import Link from 'next/link';
import { rpc } from '@/lib/api';
import { fmtDateTime, REPORT_REASON_LABEL } from '@/lib/format';
import type { ReportItem } from '@/lib/types';
import { Badge, Empty, ErrorBox, Loading, MemberOnly, PageHeader, useLoad } from '@/components/ui';

const STATUS: Record<ReportItem['status'], { label: string; tone: 'yellow' | 'green' | 'gray' | 'neutral' }> = {
  received: { label: '접수', tone: 'neutral' },
  reviewing: { label: '확인 중', tone: 'yellow' },
  resolved: { label: '처리 완료', tone: 'green' },
  rejected: { label: '반려', tone: 'gray' },
};

const TARGET = { post: '게시글', trade: '거래', user: '사용자' } as const;

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="신고 내역" back="/me" />
      <MemberOnly>
        <Reports />
      </MemberOnly>
    </>
  );
}

function Reports() {
  const { data, error, loading, reload } = useLoad(() => rpc<ReportItem[]>('my_reports'), []);
  if (loading && !data) return <Loading lines={2} />;
  return (
    <div className="stack">
      <ErrorBox error={error} onRetry={reload} />
      <p className="faint">접수번호로 처리 상태를 확인할 수 있어요. 결과가 바뀌면 알림으로 알려 드려요.</p>
      {data?.length === 0 ? (
        <Empty>신고한 내역이 없어요.</Empty>
      ) : (
        <ul className="list">
          {data?.map((r) => (
            <li key={r.report_no} className="card stack-sm" style={{ padding: 14 }}>
              <div className="row-between">
                <b>접수번호 #{r.report_no}</b>
                <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
              </div>
              <p className="small">
                {TARGET[r.target_kind]} · {REPORT_REASON_LABEL[r.reason as keyof typeof REPORT_REASON_LABEL] ?? r.reason}
              </p>
              {r.resolution && <p className="small">처리 결과: {r.resolution}</p>}
              <div className="row-between faint">
                <span>
                  {fmtDateTime(r.created_at)}
                  {r.resolved_at ? ` · 처리 ${fmtDateTime(r.resolved_at)}` : ''}
                </span>
                {r.trade_id ? (
                  <Link href={`/trades/${r.trade_id}`}>거래 보기 ›</Link>
                ) : r.post_code ? (
                  <Link href={`/posts/${r.post_code}`}>글 보기 ›</Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="faint">
        처리 결과에 이의가 있으면 <Link href="/help">도움말</Link>의 문의 경로로 알려 주세요.
      </p>
    </div>
  );
}
