'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { rpc } from '@/lib/api';
import { KIND_LABEL, METHOD_HELP, METHOD_LABEL } from '@/lib/format';
import type { Method, PostKind } from '@/lib/types';
import { Check, ErrorBox, Loading, MemberOnly, PageHeader, Stepper, useAction } from '@/components/ui';
import { useApp } from '@/components/Providers';

const KINDS: PostKind[] = ['GIVEAWAY', 'SWAP', 'REQUEST'];
const METHODS: Method[] = ['random', 'quiz', 'rps', 'manual'];
const QUICK = [
  { key: '1h', label: '1시간', hours: 1 },
  { key: '3h', label: '3시간', hours: 3 },
  { key: '12h', label: '12시간', hours: 12 },
  { key: '24h', label: '24시간', hours: 24 },
  { key: '3d', label: '3일', hours: 72 },
] as const;
const CLAIM_CHOICES = [6, 12, 24, 48, 72];

const GIVER_NOTICE = [
  '스티커는 당첨자에게 스타벅스 공식 앱에서 직접 선물해요. 선물한 스티커는 회수하기 어려워요.',
  '현금 거래, 유료 참가·재도전, 당첨 확률 판매는 할 수 없어요.',
  '바코드 번호는 게시글에 쓰지 않아요. 당첨 뒤 거래 화면에서만 제한적으로 열려요.',
  '규칙(방식·인원·마감)은 신청이 시작되면 바꿀 수 없어요. 바꾸려면 취소하고 다시 올려야 해요.',
];

type Row = { sticker_code: string; quantity: number };

export default function NewPostPage() {
  return (
    <MemberOnly message="바로 시작하기로 닉네임만 정하면 나눔·교환 글을 올릴 수 있어요.">
      <Suspense fallback={<Loading />}>
        <NewPost />
      </Suspense>
    </MemberOnly>
  );
}

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ClosingPicker({ mode, setMode, custom, setCustom }: { mode: string; setMode: (v: string) => void; custom: string; setCustom: (v: string) => void }) {
  return (
    <div className="field">
      <span className="label" id="closing-label">
        모집 마감
      </span>
      <div className="chips" role="group" aria-labelledby="closing-label">
        {QUICK.map((q) => (
          <button key={q.key} type="button" className="chip" aria-pressed={mode === q.key} onClick={() => setMode(q.key)}>
            {q.label} 뒤
          </button>
        ))}
        <button type="button" className="chip" aria-pressed={mode === 'custom'} onClick={() => setMode('custom')}>
          직접 정하기
        </button>
      </div>
      {mode === 'custom' && (
        <input
          className="input"
          type="datetime-local"
          aria-label="마감 시각"
          value={custom}
          min={toLocalInput(new Date(Date.now() + 15 * 60_000))}
          max={toLocalInput(new Date(Date.now() + 7 * 86400_000))}
          onChange={(e) => setCustom(e.target.value)}
        />
      )}
      <span className="hint">10분 뒤 ~ 7일 안, 시즌 종료 전까지 정할 수 있어요.</span>
    </div>
  );
}

function closingIso(mode: string, custom: string): string | null {
  const q = QUICK.find((x) => x.key === mode);
  if (q) return new Date(Date.now() + q.hours * 3600_000).toISOString();
  if (!custom) return null;
  const d = new Date(custom);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function NewPost() {
  const router = useRouter();
  const params = useSearchParams();
  const { boot } = useApp();
  const types = boot?.sticker_types?.length ? boot.sticker_types : [{ code: 'MISSION', name: '미션' }, { code: 'GENERAL', name: '일반' }];
  const initialKind = KINDS.includes(params?.get('kind') as PostKind) ? (params?.get('kind') as PostKind) : 'GIVEAWAY';

  const [kind, setKind] = useState<PostKind>(initialKind);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sticker, setSticker] = useState<string>(types[0].code);
  const [closeMode, setCloseMode] = useState<string>(initialKind === 'GIVEAWAY' ? '24h' : '3d');
  const [custom, setCustom] = useState(() => toLocalInput(new Date(Date.now() + 86400_000)));

  // giveaway
  const [total, setTotal] = useState(1);
  const [per, setPer] = useState(1);
  const [reserve, setReserve] = useState(1);
  const [reserveTouched, setReserveTouched] = useState(false);
  const defaultClaim = Number(boot?.settings?.claim_hours ?? 24) || 24;
  const [claim, setClaim] = useState(defaultClaim);
  const [method, setMethod] = useState<Method>('random');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [answer, setAnswer] = useState<number | null>(null);
  const [zeroPolicy, setZeroPolicy] = useState<'cancel' | 'draw_all'>('cancel');
  const [agree, setAgree] = useState(false);

  // swap
  const [offer, setOffer] = useState<Row[]>([{ sticker_code: types[1]?.code ?? types[0].code, quantity: 1 }]);
  const [want, setWant] = useState<Row[]>([{ sticker_code: types[0].code, quantity: 1 }]);

  // request
  const [reqQty, setReqQty] = useState(1);

  const { busy, error, setError, run } = useAction();
  const winners = Math.max(1, Math.floor(total / Math.max(per, 1)));

  useEffect(() => {
    if (per > total) setPer(total);
  }, [per, total]);
  useEffect(() => {
    if (!reserveTouched) setReserve(Math.min(3, winners));
  }, [winners, reserveTouched]);
  useEffect(() => {
    setClaim(defaultClaim);
  }, [defaultClaim]);

  const switchKind = (k: PostKind) => {
    setKind(k);
    setCloseMode(k === 'GIVEAWAY' ? '24h' : '3d');
    setError(null);
    router.replace(`/posts/new?kind=${k}`, { scroll: false });
  };

  const titleHint = useMemo(() => {
    const name = types.find((t) => t.code === sticker)?.name ?? '';
    if (kind === 'GIVEAWAY') return `예) ${name} ${total}장 나눔해요`;
    if (kind === 'REQUEST') return `예) ${name} ${reqQty}장만 있으면 완성이에요`;
    return '예) 일반 2장 ↔ 미션 1장 교환해요';
  }, [kind, sticker, total, reqQty, types]);

  const quizOk =
    question.trim().length >= 2 && options.every((o) => o.trim().length >= 1) && answer !== null && answer < options.length;
  const canSubmit =
    title.trim().length >= 2 &&
    !busy &&
    (kind !== 'GIVEAWAY' || (agree && (method !== 'quiz' || quizOk))) &&
    (closeMode !== 'custom' || Boolean(closingIso('custom', custom)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    void run(async () => {
      const closes_at = closingIso(closeMode, custom);
      let res: { id: string; code: string };
      if (kind === 'GIVEAWAY') {
        res = await rpc('create_giveaway', {
          p: {
            title: title.trim(), body: body.trim(), sticker_code: sticker, total_quantity: total,
            per_winner_quantity: per, winners_count: winners, reserve_count: reserve, closes_at,
            claim_hours: claim, method, agree_rules: agree,
            ...(method === 'quiz'
              ? { quiz: { question: question.trim(), options: options.map((o) => o.trim()), answer, zero_policy: zeroPolicy } }
              : {}),
          },
        });
      } else if (kind === 'SWAP') {
        res = await rpc('create_swap', { p: { title: title.trim(), body: body.trim(), offer, want, closes_at } });
      } else {
        res = await rpc('create_request', {
          p: { title: title.trim(), body: body.trim(), sticker_code: sticker, quantity: reqQty, closes_at },
        });
      }
      router.replace(`/posts/${res.code}?created=1`);
    });
  };

  return (
    <form className="stack" onSubmit={submit}>
      <PageHeader title="글쓰기" back="/posts" />

      <div className="segmented" role="tablist" aria-label="글 종류">
        {KINDS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === kind} onClick={() => switchKind(k)}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="card stack">
        <div className="field">
          <label htmlFor="title">제목</label>
          <input id="title" className="input" maxLength={60} value={title} placeholder={titleHint} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="body">설명 (선택)</label>
          <textarea
            id="body"
            className="textarea"
            maxLength={1000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="바코드 번호, 연락처 같은 개인정보는 쓰지 말아 주세요."
          />
        </div>
      </div>

      {kind !== 'SWAP' && (
        <div className="card stack">
          <div className="field">
            <span className="label" id="sticker-label">
              {kind === 'GIVEAWAY' ? '나눌 스티커' : '필요한 스티커'}
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby="sticker-label">
              {types.map((t) => (
                <button key={t.code} type="button" role="radio" aria-checked={sticker === t.code} aria-pressed={sticker === t.code} onClick={() => setSticker(t.code)}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>
          {kind === 'GIVEAWAY' ? (
            <>
              <div className="row-between">
                <span className="label">전체 장수</span>
                <Stepper label="전체 장수" value={total} min={1} max={50} onChange={setTotal} />
              </div>
              <div className="row-between">
                <span className="label">한 사람당</span>
                <Stepper label="한 사람당 장수" value={per} min={1} max={Math.min(17, total)} onChange={setPer} />
              </div>
              <div className="row-between">
                <span className="label">예비 당첨자</span>
                <Stepper
                  label="예비 당첨자 수"
                  value={reserve}
                  min={0}
                  max={5}
                  onChange={(v) => {
                    setReserveTouched(true);
                    setReserve(v);
                  }}
                />
              </div>
              <p className="small muted">
                당첨 <strong>{winners}명</strong> × {per}장
                {total - winners * per > 0 && ` (남는 ${total - winners * per}장은 나누지 않아요)`} · 당첨자가 수령하지 않으면 예비 순서대로 기회가 가요.
              </p>
            </>
          ) : (
            <div className="row-between">
              <span className="label">필요한 장수</span>
              <Stepper label="필요한 장수" value={reqQty} min={1} max={10} onChange={setReqQty} />
            </div>
          )}
        </div>
      )}

      {kind === 'SWAP' && (
        <div className="card stack">
          <SwapRows label="내가 줄 스티커" rows={offer} setRows={setOffer} types={types} />
          <hr className="divider" />
          <SwapRows label="받고 싶은 스티커" rows={want} setRows={setWant} types={types} />
          <p className="small muted">상대가 이 조건 그대로 제안하고, 내가 수락하면 교환이 시작돼요. 처음에는 적은 장수를 권해요.</p>
        </div>
      )}

      <div className="card stack">
        <ClosingPicker mode={closeMode} setMode={setCloseMode} custom={custom} setCustom={setCustom} />
        {kind === 'GIVEAWAY' && (
          <div className="field">
            <label htmlFor="claim">당첨자 수령 확인 시간</label>
            <select id="claim" className="select" value={claim} onChange={(e) => setClaim(Number(e.target.value))}>
              {Array.from(new Set([...CLAIM_CHOICES, defaultClaim])).sort((a, b) => a - b).map((h) => (
                <option key={h} value={h}>
                  당첨 후 {h}시간 안에
                </option>
              ))}
            </select>
            <span className="hint">이 시간 안에 거래 화면에서 수령 의사·스레드 아이디·바코드를 입력하지 않으면 예비 당첨자에게 넘어가요.</span>
          </div>
        )}
      </div>

      {kind === 'GIVEAWAY' && (
        <div className="card stack">
          <span className="label">선정 방식</span>
          <div className="stack-sm" role="radiogroup" aria-label="선정 방식">
            {METHODS.map((m) => (
              <label key={m} className="check">
                <input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} />
                <span>
                  <strong>{METHOD_LABEL[m]}</strong>
                  <br />
                  <span className="small muted">{METHOD_HELP[m]}</span>
                </span>
              </label>
            ))}
          </div>

          {method === 'quiz' && (
            <div className="card soft stack">
              <div className="field">
                <label htmlFor="quiz-q">문제</label>
                <input id="quiz-q" className="input" maxLength={120} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="예) 겨울 프리퀀시 완성은 총 몇 장?" />
              </div>
              <div className="stack-sm">
                <span className="label">보기 (정답에 체크)</span>
                {options.map((o, i) => (
                  <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
                    <input type="radio" name="quiz-answer" aria-label={`${i + 1}번을 정답으로`} checked={answer === i} onChange={() => setAnswer(i)} style={{ width: 22, height: 22, accentColor: 'var(--sage-deep)' }} />
                    <input
                      className="input grow"
                      maxLength={40}
                      value={o}
                      aria-label={`보기 ${i + 1}`}
                      placeholder={`보기 ${i + 1}`}
                      onChange={(e) => setOptions((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                    {options.length > 2 && (
                      <button
                        type="button"
                        className="btn ghost small"
                        aria-label={`보기 ${i + 1} 삭제`}
                        onClick={() => {
                          setOptions((prev) => prev.filter((_, j) => j !== i));
                          setAnswer((a) => (a === null ? null : a === i ? null : a > i ? a - 1 : a));
                        }}
                      >
                        삭제
                      </button>
                    )}
                  </div>
                ))}
                {options.length < 5 && (
                  <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={() => setOptions((p) => [...p, ''])}>
                    보기 추가
                  </button>
                )}
              </div>
              <div className="stack-sm" role="radiogroup" aria-label="정답자가 없을 때">
                <span className="label">정답자가 한 명도 없으면</span>
                <label className="check">
                  <input type="radio" name="zero" checked={zeroPolicy === 'cancel'} onChange={() => setZeroPolicy('cancel')} />
                  <span className="small">나눔을 취소해요</span>
                </label>
                <label className="check">
                  <input type="radio" name="zero" checked={zeroPolicy === 'draw_all'} onChange={() => setZeroPolicy('draw_all')} />
                  <span className="small">신청자 전체에서 추첨해요</span>
                </label>
              </div>
              <p className="tiny muted">정답은 마감 전까지 공개되지 않고, 해시만 미리 공개돼요. 게시 후에는 문제·정답을 바꿀 수 없어요. 공개된 상식 문제는 정답이 공유될 수 있어요.</p>
            </div>
          )}
          {method === 'rps' && (
            <p className="small muted">
              따로 입력할 건 없어요. 올리는 순간 서버가 상대 패 4개를 정하고 해시만 공개해요. 참여자는 4판을 미리 내고, 마감 뒤 상대 패가 공개돼요.
            </p>
          )}
        </div>
      )}

      {kind === 'GIVEAWAY' && (
        <div className="card stack">
          <ul className="small" style={{ margin: 0, paddingLeft: 20 }}>
            {GIVER_NOTICE.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <Check checked={agree} onChange={setAgree}>
            위 내용을 확인했고, 무료로 나눌게요.
          </Check>
        </div>
      )}

      <ErrorBox error={error} />
      <button type="submit" className="btn block" disabled={!canSubmit}>
        {busy ? '올리는 중…' : `${KIND_LABEL[kind]} 올리기`}
      </button>
      <p className="faint center">프리나눔은 스타벅스 공식 서비스가 아니에요.</p>
    </form>
  );
}

function SwapRows({ label, rows, setRows, types }: { label: string; rows: Row[]; setRows: (r: Row[]) => void; types: { code: string; name: string }[] }) {
  const unused = types.filter((t) => !rows.some((r) => r.sticker_code === t.code));
  return (
    <div className="stack-sm">
      <span className="label">{label}</span>
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
          <select
            className="select grow"
            aria-label={`${label} 종류`}
            value={r.sticker_code}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, sticker_code: e.target.value } : x)))}
          >
            {types.map((t) => (
              <option key={t.code} value={t.code} disabled={t.code !== r.sticker_code && rows.some((x) => x.sticker_code === t.code)}>
                {t.name}
              </option>
            ))}
          </select>
          <Stepper label={`${label} 장수`} value={r.quantity} min={1} max={10} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, quantity: v } : x)))} />
          {rows.length > 1 && (
            <button type="button" className="btn ghost small" aria-label="삭제" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              ✕
            </button>
          )}
        </div>
      ))}
      {unused.length > 0 && (
        <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={() => setRows([...rows, { sticker_code: unused[0].code, quantity: 1 }])}>
          종류 추가
        </button>
      )}
    </div>
  );
}
