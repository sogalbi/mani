'use client';

import { Avatar } from '@/components/Avatar';
import { Badge, PageHeader } from '@/components/ui';
import { useApp } from '@/components/Providers';
import s from '@/components/me/me.module.css';

type LevelDef = { level: number; name: string; min: number; deco: string };

const FALLBACK: LevelDef[] = [
  { level: 1, name: '새싹', min: 0, deco: '기본 새싹' },
  { level: 2, name: '네잎클로버', min: 3, deco: '작은 클로버' },
  { level: 3, name: '꽃봉오리', min: 10, deco: '봉오리 머리핀' },
  { level: 4, name: '꽃송이', min: 25, deco: '꽃 화관' },
  { level: 5, name: '나무', min: 50, deco: '작은 나뭇잎 망토' },
  { level: 6, name: '반짝정원', min: 100, deco: '반짝 꽃 장식' },
];

export default function RewardsPage() {
  const { boot, me } = useApp();
  const raw = boot?.settings?.levels;
  const levels = (Array.isArray(raw) ? (raw as LevelDef[]) : FALLBACK).slice().sort((a, b) => a.min - b.min);
  const given = me?.badge?.level?.given ?? 0;
  const current = me?.badge?.level?.level ?? 1;

  return (
    <>
      <PageHeader title="캐릭터 장식" back="/me" />
      <div className="card sage stack-sm">
        <p className="small">
          {me?.nickname ? (
            <>
              <b>{me.nickname}</b>님은 지금까지 확인된 무료 나눔 <b>{given}장</b>이에요.
            </>
          ) : (
            '시작하면 내 단계를 볼 수 있어요.'
          )}
        </p>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>받는 분이 수령을 확인한 무료 나눔만, 거래당 한 번 세요.</li>
          <li>교환은 따로 기록하고 나눔 장수에는 더하지 않아요.</li>
          <li>단계는 감사의 표현이에요. 추첨 확률이나 교환 우선권에는 영향이 없어요.</li>
          <li>허위 거래로 확인되면 기록을 남기고 점수가 회수될 수 있어요.</li>
        </ul>
      </div>
      <ul className="list">
        {levels.map((l) => {
          const unlocked = given >= l.min;
          return (
            <li key={l.level} className={`card ${s.ladder}`} style={{ padding: 12 }}>
              <div className={unlocked ? undefined : s.locked}>
                <Avatar level={l.level} size={64} label={`${l.name} 단계 캐릭터`} />
              </div>
              <div className="grow stack-sm">
                <div className="row" style={{ gap: 6 }}>
                  <b>
                    Lv.{l.level} {l.name}
                  </b>
                  {l.level === current && me && <Badge tone="green">지금</Badge>}
                  {!unlocked && <Badge tone="gray">잠김</Badge>}
                </div>
                <p className="small">{l.deco}</p>
                <p className="faint">{l.min === 0 ? '처음부터' : `무료 나눔 ${l.min}장 완료`}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
