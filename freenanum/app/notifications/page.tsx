'use client';

import { useRouter } from 'next/navigation';
import { rpc } from '@/lib/api';
import { fmtAgo } from '@/lib/format';
import type { NotificationItem } from '@/lib/types';
import { Empty, ErrorBox, Loading, MemberOnly, PageHeader, useAction, useLoad } from '@/components/ui';
import { useApp } from '@/components/Providers';
import s from '@/components/me/me.module.css';

export default function NotificationsPage() {
  return (
    <MemberOnly message="시작하면 당첨·거래 알림을 여기에서 볼 수 있어요.">
      <Notifications />
    </MemberOnly>
  );
}

function Notifications() {
  const router = useRouter();
  const { refreshMe } = useApp();
  const { data, error, loading, reload, setData } = useLoad(() => rpc<NotificationItem[]>('my_notifications', { p_limit: 50 }), []);
  const { busy, error: actionError, run } = useAction();
  const unread = (data ?? []).filter((n) => !n.read_at).length;

  const open = async (n: NotificationItem) => {
    if (!n.read_at) {
      setData((list) => list?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? null);
      try {
        await rpc('mark_notifications_read', { p_ids: [n.id] });
      } catch {
        // reading still works even if marking fails
      }
      void refreshMe();
    }
    if (n.link && n.link.startsWith('/')) router.push(n.link);
  };

  const readAll = () =>
    run(async () => {
      await rpc('mark_notifications_read', { p_ids: null });
      await reload();
      void refreshMe();
    });

  return (
    <>
      <PageHeader
        title="알림"
        back
        right={
          unread > 0 && (
            <button className="btn ghost small" onClick={() => void readAll()} disabled={busy}>
              모두 읽음
            </button>
          )
        }
      />
      <ErrorBox error={error ?? actionError} onRetry={reload} />
      {loading && !data ? (
        <Loading lines={3} />
      ) : data?.length === 0 ? (
        <Empty>아직 알림이 없어요.</Empty>
      ) : (
        <ul className="list">
          {data?.map((n) => (
            <li key={n.id}>
              <button type="button" className={`${s.notif} ${n.read_at ? s.notifRead : ''}`} onClick={() => void open(n)}>
                {!n.read_at ? <span className={s.unread} aria-label="안 읽음" /> : <span style={{ width: 9, flex: 'none' }} />}
                <span className="stack-sm grow">
                  <b className="small">{n.title}</b>
                  {n.body && <span className="small muted">{n.body}</span>}
                  <span className="faint">{fmtAgo(n.created_at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="faint">알림은 앱 안에서만 보여요. 기한이 있는 단계는 거래 화면에서 꼭 확인해 주세요.</p>
    </>
  );
}
