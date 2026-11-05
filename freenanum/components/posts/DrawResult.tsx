'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fmtDateTime, TRADE_STATUS_LABEL } from '@/lib/format';
import type { GiveawayDetail } from '@/lib/types';
import { Badge } from '@/components/ui';

export const RPS_EMOJI: Record<string, string> = { R: '✊', P: '✋', S: '✌️' };
export const RPS_NAME: Record<string, string> = { R: '바위', P: '보', S: '가위' };

export function rpsText(moves: string | null | undefined): string {
  return (moves ?? '').split('').map((m) => RPS_EMOJI[m] ?? m).join(' ');
}

async function sha256Hex(text: string): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Recomputes the published commitment in the browser: sha256("<answer or moves>:<nonce>"). */
function CommitmentCheck({ g }: { g: GiveawayDetail }) {
  const [state, setState] = useState<'checking' | 'match' | 'mismatch' | 'unsupported' | 'none'>('checking');
  const d = g.draw;
  const secret = g.method === 'quiz' ? d?.revealed_quiz_answer : g.method === 'rps' ? d?.revealed_rps_moves : null;
  const commitment = g.method === 'quiz' ? g.quiz_commitment : g.rps_commitment;

  useEffect(() => {
    if (secret === null || secret === undefined || !d?.revealed_nonce || !commitment) {
      setState('none');
      return;
    }
    let alive = true;
    sha256Hex(`${secret}:${d.revealed_nonce}`).then((h) => {
      if (!alive) return;
      setState(h === null ? 'unsupported' : h === commitment ? 'match' : 'mismatch');
    });
    return () => {
      alive = false;
    };
  }, [secret, d?.revealed_nonce, commitment]);

  if (state === 'none') return null;
  return (
    <div className={state === 'mismatch' ? 'error-box' : state === 'match' ? 'ok-box' : 'notice'}>
      {state === 'checking' && '사전 공개 해시와 비교하는 중…'}
      {state === 'match' && '✓ 일치 — 모집 전에 공개한 해시와 마감 후 공개한 값이 같아요. 정답(상대 패)이 중간에 바뀌지 않았어요.'}
      {state === 'mismatch' && '✗ 불일치 — 공개된 값이 사전 해시와 달라요. 운영자에게 신고해 주세요.'}
      {state === 'unsupported' && '이 브라우저에서는 해시를 직접 계산할 수 없어요. 아래 값으로 따로 확인할 수 있어요.'}
    </div>
  );
}

export default function DrawResult({ g, isAuthor }: { g: GiveawayDetail; isAuthor: boolean }) {
  const d = g.draw;
  if (!d) return null;
  const mine = g.my_result;
  const entry = g.my_entry;

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row-between">
          <h2>{d.manual ? '선정 결과' : '추첨 결과'}</h2>
          <span className="faint">{fmtDateTime(d.executed_at)}</span>
        </div>
        {d.manual && <div className="notice warn">나눔자가 직접 선정했어요(무작위 아님).</div>}
        {d.outcome === 'no_entries' && <p className="muted">신청자가 없어 나눔이 마감됐어요.</p>}
        {d.outcome === 'no_correct_canceled' && <p className="muted">정답자가 없어 미리 정한 규칙대로 나눔이 취소됐어요.</p>}
        {d.outcome === 'no_correct_draw_all' && <p className="muted">정답자가 없어 미리 정한 규칙대로 신청자 전체에서 추첨했어요.</p>}

        {/* my result */}
        {entry && entry.status === 'active' && (
          <div className={mine ? (mine.role === 'winner' || mine.promoted ? 'ok-box stack-sm' : 'notice stack-sm') : 'notice'}>
            {mine && (mine.role === 'winner' || mine.promoted) ? (
              <>
                <strong>🎉 {mine.promoted ? '예비 순서에서 기회가 왔어요!' : '당첨됐어요!'}</strong>
                <span className="small">{g.claim_hours}시간 안에 거래 화면에서 스레드 아이디와 바코드를 입력해 주세요.</span>
                {mine.trade_id && (
                  <Link className="btn small" href={`/trades/${mine.trade_id}`} style={{ alignSelf: 'flex-start' }}>
                    거래 화면으로 가기
                  </Link>
                )}
              </>
            ) : mine?.role === 'reserve' ? (
              <span>예비 {mine.rank - g.winners_count}번이에요. 앞 순서 당첨자가 기한 안에 수령하지 않으면 순서대로 기회가 와요.</span>
            ) : (
              <span>아쉽게도 이번에는 당첨되지 않았어요.</span>
            )}
            {g.method === 'quiz' && entry.quiz_correct !== null && (
              <span className="small">내 답: {entry.quiz_correct ? '정답 ⭕' : '오답 ❌'}</span>
            )}
            {g.method === 'rps' && entry.rps_wins !== null && (
              <span className="small">
                내 패 {rpsText(entry.rps_choices)} → {entry.rps_wins}승
              </span>
            )}
          </div>
        )}

        {d.winners.length > 0 && (
          <ol className="list" aria-label="당첨·예비 순서">
            {d.winners.map((w) => (
              <li key={w.rank} className="row-between card flat" style={{ padding: '10px 12px' }}>
                <span className="row" style={{ gap: 8 }}>
                  <span className="faint">{w.rank}</span>
                  <Badge tone={w.role === 'winner' ? 'green' : 'neutral'}>{w.role === 'winner' ? '당첨' : '예비'}</Badge>
                  <strong>{w.nickname}</strong>
                  {w.is_me && <Badge tone="terra">나</Badge>}
                </span>
                <span className="row faint" style={{ gap: 6 }}>
                  {g.method === 'rps' && w.rps_wins !== null && <span>{w.rps_wins}승</span>}
                  {w.promoted && <Badge tone="yellow">승계</Badge>}
                  {w.trade_status && <span>{TRADE_STATUS_LABEL[w.trade_status]}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
        {!isAuthor && <p className="faint">다른 참여자의 닉네임은 일부만 보여요.</p>}
      </div>

      <details className="card flat">
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>추첨 검증 정보</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          {d.manual ? (
            <p className="small muted">직접 선정은 무작위 추첨이 아니라 검증용 시드가 없어요. 신청자 명단 해시만 기록돼요.</p>
          ) : (
            <p className="small muted">
              서버가 마감 뒤 한 번만 추첨했어요. 순서는 <span className="mono">{d.ordering}</span> 기준이고, 시드는 추첨 순간 서버의 안전한 난수로 만들었어요.
            </p>
          )}
          <dl className="kv">
            <dt>신청</dt>
            <dd>{d.entries_count}명</dd>
            <dt>추첨 대상</dt>
            <dd>{d.eligible_count}명</dd>
            {g.method === 'quiz' && d.revealed_quiz_answer !== null && (
              <>
                <dt>정답</dt>
                <dd>{g.quiz_options?.[d.revealed_quiz_answer] ?? d.revealed_quiz_answer}</dd>
              </>
            )}
            {g.method === 'rps' && d.revealed_rps_moves && (
              <>
                <dt>상대 패</dt>
                <dd>
                  {d.revealed_rps_moves.split('').map((m, i) => (
                    <span key={i} title={RPS_NAME[m]}>
                      {i + 1}판 {RPS_EMOJI[m]}{' '}
                    </span>
                  ))}
                </dd>
              </>
            )}
          </dl>
          <CommitmentCheck g={g} />
          <div className="stack-sm">
            {d.seed && <Hash label="시드(seed)" value={d.seed} />}
            <Hash label="대상자 명단 해시" value={d.eligible_hash} />
            {d.revealed_nonce && <Hash label="공개된 nonce" value={d.revealed_nonce} />}
            {g.quiz_commitment && <Hash label="사전 공개 정답 해시" value={g.quiz_commitment} />}
            {g.rps_commitment && <Hash label="사전 공개 상대 패 해시" value={g.rps_commitment} />}
            <Hash label="규칙 해시" value={g.rules_hash} />
          </div>
        </div>
      </details>
    </div>
  );
}

export function Hash({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="tiny muted">{label}</div>
      <div className="mono">{value}</div>
    </div>
  );
}
