'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { rpc } from '@/lib/api';
import { fmtDateTime, METHOD_HELP, METHOD_LABEL, TRADE_STATUS_LABEL } from '@/lib/format';
import type { PostDetail } from '@/lib/types';
import { Badge, Check, Countdown, ErrorBox, LoginRequired, Sheet, useAction } from '@/components/ui';
import { useApp } from '@/components/Providers';
import DrawResult, { Hash, RPS_EMOJI, RPS_NAME, rpsText } from './DrawResult';

const ENTRY_NOTICE =
  '나눔 참여가 당첨을 보장하지는 않아요. 선정 방식, 마감 시각, 당첨·예비 규칙과 수령 기한을 확인해 주세요.';

function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export default function GiveawayPanel({ post, reload }: { post: PostDetail; reload: () => void }) {
  const g = post.giveaway!;
  const { session, me, boot, toast } = useApp();
  const now = useNow();
  const closed = now >= new Date(g.closes_at).getTime();
  const member = Boolean(session && me && !me.needs_profile);
  const entry = g.my_entry;
  const { busy, error, run } = useAction();

  const draw = () =>
    run(async () => {
      await rpc('draw_giveaway', { p_post_id: post.id });
      reload();
    });

  const withdraw = () =>
    run(async () => {
      await rpc('withdraw_entry', { p_post_id: post.id });
      toast('신청을 취소했어요');
      reload();
    });

  return (
    <div className="stack">
      {/* rules */}
      <section className="card stack" aria-labelledby="rules-title">
        <div className="row-between">
          <h2 id="rules-title">나눔 규칙</h2>
          <Badge tone="green">{METHOD_LABEL[g.method]}</Badge>
        </div>
        <p className="small muted">{METHOD_HELP[g.method]}</p>
        <dl className="kv">
          <dt>스티커</dt>
          <dd>
            {g.sticker.name} 총 {g.total_quantity}장
          </dd>
          <dt>1인당</dt>
          <dd>{g.per_winner_quantity}장</dd>
          <dt>당첨</dt>
          <dd>
            {g.winners_count}명 {g.reserve_count > 0 && <span className="muted">· 예비 {g.reserve_count}명</span>}
          </dd>
          <dt>마감</dt>
          <dd>
            {fmtDateTime(g.closes_at)}
            {!closed && g.state === 'open' && (
              <span className="muted">
                {' '}
                (<Countdown to={g.closes_at} />)
              </span>
            )}
          </dd>
          <dt>수령 기한</dt>
          <dd>당첨 후 {g.claim_hours}시간 안에 거래 화면에서 수령 의사·스레드 아이디·바코드 입력</dd>
          <dt>신청</dt>
          <dd>{g.entries_count}명</dd>
        </dl>
        {g.method === 'quiz' && g.quiz_question && (
          <div className="card soft stack-sm">
            <strong>Q. {g.quiz_question}</strong>
            <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
              {g.quiz_options?.map((o, i) => <li key={i}>{o}</li>)}
            </ol>
            <span className="tiny muted">
              정답자가 없으면: {g.quiz_zero_policy === 'draw_all' ? '신청자 전체에서 추첨' : '나눔 취소'}
            </span>
          </div>
        )}
        <details>
          <summary className="small" style={{ cursor: 'pointer', fontWeight: 700 }}>
            공정성 기록
          </summary>
          <div className="stack-sm" style={{ marginTop: 8 }}>
            <p className="tiny muted">
              규칙은 게시할 때 고정되고 해시로 기록돼요.
              {g.method === 'quiz' && ' 정답은 해시만 미리 공개하고, 마감 뒤에 원래 값을 공개해 비교할 수 있어요.'}
              {g.method === 'rps' && ' 상대 패 4개는 모집 전에 서버가 정했고, 해시만 미리 공개해요. 마감 뒤 공개해 비교할 수 있어요.'}
            </p>
            <Hash label="규칙 해시" value={g.rules_hash} />
            {g.quiz_commitment && <Hash label="정답 해시(사전 공개)" value={g.quiz_commitment} />}
            {g.rps_commitment && <Hash label="상대 패 해시(사전 공개)" value={g.rps_commitment} />}
          </div>
        </details>
      </section>

      <ErrorBox error={error} />

      {/* states */}
      {g.state === 'canceled' && (
        <div className="card soft">
          <strong>취소된 나눔이에요.</strong>
          {(post.status_note || g.canceled_reason) && <p className="small muted">사유: {post.status_note || g.canceled_reason}</p>}
        </div>
      )}

      {g.state === 'open' && !closed && (
        <>
          {post.is_author ? (
            <AuthorOpenTools post={post} reload={reload} />
          ) : entry?.status === 'active' ? (
            <div className="ok-box stack-sm">
              <strong>신청했어요 ✓</strong>
              {g.method === 'quiz' && entry.quiz_choice !== null && (
                <span className="small">내 답: {g.quiz_options?.[entry.quiz_choice]}</span>
              )}
              {g.method === 'rps' && <span className="small">내 패: {rpsText(entry.rps_choices)} (바꿀 수 없어요)</span>}
              <span className="small">마감 뒤 결과를 알림으로 알려 드려요.</span>
              {(g.method === 'random' || g.method === 'manual') && (
                <button className="btn secondary small" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={withdraw}>
                  신청 취소
                </button>
              )}
            </div>
          ) : entry && (entry.status === 'invalid' || g.method === 'quiz' || g.method === 'rps') ? (
            <div className="notice">취소한 신청은 다시 참여할 수 없어요.</div>
          ) : post.blocked ? (
            <div className="notice">차단 관계라 참여할 수 없어요.</div>
          ) : !session ? (
            <LoginRequired message="바로 시작하기로 닉네임만 정하면 신청할 수 있어요. 시작한 뒤 이 글로 돌아와요." />
          ) : !member ? (
            me?.needs_profile ? <LoginRequired message="닉네임을 정하면 바로 신청할 수 있어요." /> : null
          ) : (
            <EntryForm post={post} reload={reload} />
          )}
        </>
      )}

      {g.state === 'open' && closed && (
        <div className="card butter stack">
          {g.method === 'manual' ? (
            post.is_author ? (
              <ManualSelect post={post} reload={reload} />
            ) : (
              <>
                <strong>모집이 끝났어요. 나눔자가 직접 고르는 중이에요.</strong>
                <p className="small">
                  무작위 추첨이 아니라 나눔자가 신청자 중에서 선정해요. 마감 뒤{' '}
                  {String(boot?.settings?.manual_select_hours ?? 48)}시간 안에 선정하지 않으면 자동으로 취소돼요.
                </p>
              </>
            )
          ) : (
            <>
              <strong>모집이 끝났어요. 곧 추첨 결과가 나와요.</strong>
              <p className="small">
                추첨은 서버에서 딱 한 번만 실행돼요. 누가 버튼을 눌러도 결과는 같고, 몇 분 안에 자동으로도 실행돼요.
              </p>
              {member ? (
                <button className="btn" disabled={busy} onClick={draw}>
                  {busy ? '확인 중…' : '결과 보기'}
                </button>
              ) : (
                <button className="btn secondary" onClick={reload}>
                  새로 고침
                </button>
              )}
            </>
          )}
        </div>
      )}

      {g.state === 'drawn' && <DrawResult g={g} isAuthor={post.is_author} />}

      {post.is_author && post.trades && post.trades.length > 0 && (
        <section className="card stack" aria-labelledby="handoff-title">
          <h2 id="handoff-title">전달 현황</h2>
          <ul className="list">
            {post.trades.map((t) => (
              <li key={t.id}>
                <Link href={`/trades/${t.id}`} className="row-between card flat" style={{ padding: '10px 12px' }}>
                  <strong>{t.counterpart}</strong>
                  <span className="faint">{TRADE_STATUS_LABEL[t.status]} ›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function EntryForm({ post, reload }: { post: PostDetail; reload: () => void }) {
  const g = post.giveaway!;
  const { toast } = useApp();
  const [choice, setChoice] = useState<number | null>(null);
  const [moves, setMoves] = useState<(string | null)[]>([null, null, null, null]);
  const [locked, setLocked] = useState(false);
  const { busy, error, run } = useAction();

  const rps = moves.every(Boolean) ? moves.join('') : null;
  const ready =
    g.method === 'quiz' ? choice !== null : g.method === 'rps' ? Boolean(rps) && locked : true;

  const submit = () =>
    run(async () => {
      await rpc('enter_giveaway', {
        p_post_id: post.id,
        p_quiz_choice: g.method === 'quiz' ? choice : null,
        p_rps: g.method === 'rps' ? rps : null,
      });
      toast('신청했어요! 결과는 알림으로 알려 드려요.');
      reload();
    });

  return (
    <section className="card stack" aria-labelledby="entry-title">
      <h2 id="entry-title">참여하기</h2>
      {g.method === 'quiz' && (
        <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 6 }}>
            Q. {g.quiz_question}
          </legend>
          {g.quiz_options?.map((o, i) => (
            <label key={i} className="check">
              <input type="radio" name="quiz" checked={choice === i} onChange={() => setChoice(i)} />
              <span>{o}</span>
            </label>
          ))}
          <p className="tiny muted">한 번 낸 답은 바꿀 수 없어요.</p>
        </fieldset>
      )}
      {g.method === 'rps' && (
        <div className="stack-sm">
          <p className="small muted">4판을 한 번에 골라요. 상대 패는 이미 정해져 있고 마감 뒤에 공개돼요.</p>
          {moves.map((m, i) => (
            <div key={i} className="row-between">
              <span className="label">{i + 1}판</span>
              <div className="segmented" role="group" aria-label={`${i + 1}판 선택`} style={{ flex: 1, maxWidth: 260 }}>
                {(['R', 'P', 'S'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={m === k}
                    disabled={locked}
                    onClick={() => setMoves((prev) => prev.map((x, j) => (j === i ? k : x)))}
                  >
                    {RPS_EMOJI[k]} {RPS_NAME[k]}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <Check checked={locked} onChange={(v) => rps && setLocked(v)}>
            {rps ? `${rpsText(rps)} — 제출 후 바꿀 수 없어요. 이대로 낼게요.` : '4판을 모두 고르면 확정할 수 있어요.'}
          </Check>
        </div>
      )}
      <div className="notice">{ENTRY_NOTICE}</div>
      <ErrorBox error={error} />
      <button className="btn block" disabled={!ready || busy} onClick={submit}>
        {busy ? '신청 중…' : '신청하기'}
      </button>
    </section>
  );
}

function AuthorOpenTools({ post, reload }: { post: PostDetail; reload: () => void }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const cancel = () =>
    run(async () => {
      await rpc('cancel_giveaway', { p_post_id: post.id, p_reason: reason.trim() });
      toast('나눔을 취소했어요. 신청자에게 알림이 가요.');
      setOpen(false);
      reload();
    });
  return (
    <div className="card sage stack-sm">
      <strong>내가 올린 나눔이에요</strong>
      <p className="small">
        지금 {post.giveaway!.entries_count}명이 신청했어요. 규칙(방식·인원·마감)은 신청이 시작된 뒤 바꿀 수 없어요.
      </p>
      <button className="btn danger small" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        나눔 취소
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="나눔 취소">
        <p className="small">취소하면 신청자 모두에게 사유와 함께 알림이 가요. 되돌릴 수 없어요.</p>
        <div className="field">
          <label htmlFor="cancel-reason">취소 사유</label>
          <input id="cancel-reason" className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <ErrorBox error={error} />
        <button className="btn danger block" disabled={busy || reason.trim().length < 2} onClick={cancel}>
          취소하기
        </button>
      </Sheet>
    </div>
  );
}

function ManualSelect({ post, reload }: { post: PostDetail; reload: () => void }) {
  const g = post.giveaway!;
  const entrants = g.entrants ?? [];
  const max = g.winners_count + g.reserve_count;
  const [picked, setPicked] = useState<string[]>([]);
  const [sure, setSure] = useState(false);
  const { busy, error, run } = useAction();

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= max ? p : [...p, id]));

  const submit = () =>
    run(async () => {
      await rpc('select_winners', { p_post_id: post.id, p_user_ids: picked });
      reload();
    });

  return (
    <div className="stack">
      <strong>신청자 중에서 직접 골라 주세요</strong>
      <p className="small">
        누른 순서대로 앞 {g.winners_count}명은 당첨, 다음 {g.reserve_count}명은 예비가 돼요. 결과에는 &ldquo;직접 선정(무작위 아님)&rdquo;으로 표시돼요.
      </p>
      {entrants.length === 0 ? (
        <p className="muted">신청자가 없어요.</p>
      ) : (
        <ul className="list">
          {entrants.map((e) => {
            const idx = picked.indexOf(e.user_id);
            return (
              <li key={e.user_id}>
                <label className="check" style={{ alignItems: 'center' }}>
                  <input type="checkbox" checked={idx >= 0} onChange={() => toggle(e.user_id)} />
                  <span className="grow">
                    <strong>{e.nickname}</strong>
                    <span className="tiny muted">
                      {' '}
                      · {e.badge.level.name} · 완료 {e.badge.completed_trades}건
                      {e.badge.unfulfilled > 0 && ` · 미이행 ${e.badge.unfulfilled}건`}
                    </span>
                  </span>
                  {idx >= 0 && <Badge tone={idx < g.winners_count ? 'green' : 'neutral'}>{idx < g.winners_count ? `당첨 ${idx + 1}` : `예비 ${idx - g.winners_count + 1}`}</Badge>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <Check checked={sure} onChange={setSure}>
        확정하면 바꿀 수 없어요. 이대로 선정할게요.
      </Check>
      <ErrorBox error={error} />
      <button className="btn" disabled={busy || picked.length === 0 || !sure} onClick={submit}>
        선정 확정 ({picked.length}명)
      </button>
    </div>
  );
}
