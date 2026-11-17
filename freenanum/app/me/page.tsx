'use client';

import Link from 'next/link';
import { rpc } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import type { Me, Summary } from '@/lib/types';
import { Avatar } from '@/components/Avatar';
import { ErrorBox, Loading, LoginRequired, PageHeader, useLoad } from '@/components/ui';
import { useApp } from '@/components/Providers';
import LevelProgress from '@/components/me/LevelProgress';
import s from '@/components/me/me.module.css';

export default function MePage() {
  const { ready, session, me } = useApp();
  if (!ready || (session && !me)) return <Loading lines={3} />;
  if (!session || !me || me.needs_profile) {
    return (
      <>
        <PageHeader title="MY" />
        <div className="card soft stack-sm">
          <div className={s.hero}>
            <Avatar level={1} size={64} label="기본 새싹 캐릭터" />
            <p className="small">
              MY에는 나눔한 장수·나눔받은 장수·교환 기록, 진행 중인 거래, 나만의 동화 캐릭터 장식이 모여요.
            </p>
          </div>
        </div>
        <LoginRequired message={me?.needs_profile ? '닉네임을 정하면 바로 시작할 수 있어요.' : '닉네임만 정하면 바로 시작할 수 있어요.'} />
      </>
    );
  }
  return <MeView me={me} />;
}

function MeView({ me }: { me: Me }) {
  const { data: sum, error, reload } = useLoad(() => rpc<Summary>('my_summary'), []);
  const lv = me.badge?.level;
  const c = sum?.campaign;

  return (
    <>
      <PageHeader
        title="MY"
        right={
          <Link className="btn ghost small" href="/settings">
            설정
          </Link>
        }
      />
      {me.account_status && me.account_status !== 'active' && (
        <div className="notice danger">
          {me.account_status === 'suspended'
            ? '이용이 정지된 계정이에요.'
            : `이용이 제한된 계정이에요${me.restricted_until ? ` (${fmtDate(me.restricted_until)}까지)` : ''}. 새 참여는 할 수 없고, 진행 중인 거래는 마무리할 수 있어요.`}{' '}
          <Link href="/help">이의신청·문의</Link>
        </div>
      )}

      <section className="card stack" aria-label="내 캐릭터">
        <div className={s.hero}>
          <Avatar level={lv?.level ?? 1} size={88} label={`${me.nickname}의 캐릭터 · ${lv?.deco ?? '기본 새싹'}`} />
          <div className="stack-sm grow">
            <h2>{me.nickname}</h2>
            <p className="small">
              Lv.{lv?.level ?? 1} <b>{lv?.name ?? '새싹'}</b> · {lv?.deco ?? '기본 새싹'}
            </p>
            {me.badge?.threads?.verified && <span className="faint">스레드 @{me.badge.threads.handle} 계정 소유 확인</span>}
          </div>
        </div>
        {lv && <LevelProgress level={lv} />}
      </section>

      <section className="card stack" aria-labelledby="season-h">
        <div className="row-between">
          <h2 id="season-h">이번 시즌 기록</h2>
          <Link className="faint" href="/me/history">
            전체 이력 ›
          </Link>
        </div>
        <ErrorBox error={error} onRetry={reload} />
        <div className={s.stats}>
          <div className={s.stat}>
            <b>{c?.given ?? me.progress?.given ?? 0}</b>
            <span>나눔한 장수</span>
          </div>
          <div className={s.stat}>
            <b>{c?.received ?? me.progress?.received ?? 0}</b>
            <span>나눔받은 장수</span>
          </div>
          <div className={s.stat}>
            <b>{c?.swaps ?? me.progress?.swaps ?? 0}</b>
            <span>교환 완료</span>
          </div>
        </div>
        {sum && (
          <p className="faint">
            지금까지 전체: 나눔 {sum.all_time.given}장 · 받음 {sum.all_time.received}장 · 교환 {sum.all_time.swaps}건 · 진행 중 거래 {sum.trades.active}건
            {sum.trades.problem > 0 ? ` · 확인 필요 ${sum.trades.problem}건` : ''}
          </p>
        )}
        <p className="faint">
          완료 거래 {me.badge?.completed_trades ?? 0}건 · 미이행 기록 {me.badge?.unfulfilled ?? 0}건 — 신뢰 기록은 성장 단계와 따로 관리돼요.
        </p>
      </section>

      <nav className="card" aria-label="MY 메뉴" style={{ paddingTop: 4, paddingBottom: 4 }}>
        <ul className={s.links}>
          <li>
            <Link href="/trades">
              진행 중인 거래 {me.action_needed ? <span className="badge yellow">할 일 {me.action_needed}</span> : <span aria-hidden>›</span>}
            </Link>
          </li>
          <li>
            <Link href="/me/history">
              내 나눔·교환 이력 <span aria-hidden>›</span>
            </Link>
          </li>
          <li>
            <Link href="/me/history?tab=posts">
              내 글 · 참여한 나눔 <span aria-hidden>›</span>
            </Link>
          </li>
          <li>
            <Link href="/me/contacts">
              거래 상대 <span className="faint">(자동 저장)</span> <span aria-hidden>›</span>
            </Link>
          </li>
          <li>
            <Link href="/me/rewards">
              캐릭터 장식 <span aria-hidden>›</span>
            </Link>
          </li>
          <li>
            <Link href="/notifications">
              알림 {me.unread_notifications ? <span className="badge terra">{me.unread_notifications}</span> : <span aria-hidden>›</span>}
            </Link>
          </li>
          <li>
            <Link href="/me/reports">
              신고 내역 <span aria-hidden>›</span>
            </Link>
          </li>
          <li>
            <span className={s.disabled}>
              감사 우체통 <span className="faint">곧 열려요</span>
            </span>
          </li>
          <li>
            <Link href="/settings">
              설정 · 스레드 연결 · 차단 <span aria-hidden>›</span>
            </Link>
          </li>
        </ul>
      </nav>
    </>
  );
}
