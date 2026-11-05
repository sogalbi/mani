import { Avatar } from '@/components/Avatar';
import type { Badge } from '@/lib/types';

/** Giver/author profile: growth level and trade record are separate signals (spec §12). */
export default function AuthorCard({ badge, label = '올린 사람' }: { badge: Omit<Badge, 'user_id'>; label?: string }) {
  const threads = badge.threads?.verified ? badge.threads : null;
  return (
    <div className="card flat row" style={{ gap: 12, alignItems: 'center' }}>
      <Avatar level={badge.level.level} size={56} label={`${badge.nickname}의 캐릭터`} />
      <div className="grow stack-sm" style={{ gap: 2 }}>
        <span className="faint">{label}</span>
        <strong>{badge.nickname}</strong>
        <span className="tiny muted">
          {badge.level.name} · 나눔 확인 {badge.level.given}장 · 완료 거래 {badge.completed_trades}건
          {badge.unfulfilled > 0 && <span style={{ color: 'var(--red)' }}> · 미이행 {badge.unfulfilled}건</span>}
        </span>
        {threads && (
          <span className="tiny muted">
            스레드 @{threads.handle} · <span className="badge green">계정 소유 확인</span>
          </span>
        )}
        {badge.restricted && <span className="tiny" style={{ color: 'var(--red)' }}>현재 이용 제한 중인 계정이에요</span>}
      </div>
    </div>
  );
}
