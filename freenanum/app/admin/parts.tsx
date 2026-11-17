'use client';

import Link from 'next/link';
import { useState } from 'react';
import { errorMessage, rpc } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import {
  DISPUTE_REASON_LABEL, fmtDateTime, REPORT_REASON_LABEL, TRADE_STATUS_LABEL,
} from '@/lib/format';
import type { Badge as BadgeT, ReportReason, TradeStatus } from '@/lib/types';
import { Badge, Empty, ErrorBox, Loading, TradeStatusBadge, useAction, useLoad } from '@/components/ui';
import { useApp } from '@/components/Providers';

/* ---------- shared bits ---------- */

function confirmed(msg: string) {
  return typeof window !== 'undefined' && window.confirm(msg);
}

function Chips<T extends string>({ value, options, onChange, label }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" className="chip" aria-pressed={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- 개요 ---------- */

const OVERVIEW: [string, string][] = [
  ['reports_open', '처리할 신고'],
  ['trades_disputed', '분쟁 거래'],
  ['trades_overdue', '기한 지난 거래'],
  ['trades_active', '진행 중 거래'],
  ['trades_completed', '완료 거래'],
  ['stickers_given', '나눔 완료 장수'],
  ['posts_open', '모집 중 글'],
  ['members', '회원'],
  ['givers', '나눔자 수'],
  ['threads_pending', '스레드 확인 대기'],
];

export function OverviewTab() {
  const { data, error, loading, reload } = useLoad(() => rpc<Record<string, number>>('admin_overview'), []);
  const act = useAction();
  const [result, setResult] = useState<string | null>(null);
  async function runJobs() {
    const r = await act.run(() => rpc<{ drawn: number; expired: number; disputed: number }>('admin_run_jobs'));
    if (r) {
      setResult(`추첨 ${r.drawn}건 · 만료 ${r.expired}건 · 분쟁 전환 ${r.disputed}건`);
      void reload();
    }
  }
  if (loading && !data) return <Loading />;
  return (
    <div className="stack">
      <ErrorBox error={error} onRetry={reload} />
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {OVERVIEW.map(([k, label]) => (
            <div key={k} className="card flat stack-sm" style={{ padding: 12 }}>
              <span className="faint">{label}</span>
              <b style={{ fontSize: '1.4rem' }}>{data[k] ?? 0}</b>
            </div>
          ))}
        </div>
      )}
      <div className="card soft stack">
        <p className="small">마감된 나눔 추첨, 응답 기한 만료, 수령 확인 지연(분쟁 전환)을 지금 처리해요. 평소에는 5분마다 자동으로 돌아요.</p>
        <button className="btn secondary" onClick={() => void runJobs()} disabled={act.busy}>
          {act.busy ? '처리 중…' : '기한 처리 지금 실행'}
        </button>
        {result && <p className="ok-box">{result}</p>}
        <ErrorBox error={act.error} />
      </div>
    </div>
  );
}

/* ---------- 신고 ---------- */

interface AdminReport {
  id: string; report_no: number; target_kind: 'post' | 'trade' | 'user'; reason: ReportReason; detail: string;
  status: 'received' | 'reviewing' | 'resolved' | 'rejected'; resolution: string | null; created_at: string;
  reporter: string | null; target_user: string | null; trade_id: string | null; trade_status: TradeStatus | null;
  post_code: string | null;
}

const REPORT_STATUS: [AdminReport['status'], string][] = [
  ['received', '접수'], ['reviewing', '검토 중'], ['resolved', '처리 완료'], ['rejected', '반려'],
];

function ReportItem({ r, onDone }: { r: AdminReport; onDone: () => void }) {
  const { toast } = useApp();
  const [note, setNote] = useState(r.resolution ?? '');
  const act = useAction();
  async function update(status: AdminReport['status']) {
    if (status !== 'reviewing' && note.trim().length < 2) {
      act.setError('처리 내용(사유)을 적어 주세요.');
      return;
    }
    if (status !== 'reviewing' && !confirmed(`신고 #${r.report_no}을(를) "${REPORT_STATUS.find((s) => s[0] === status)?.[1]}"(으)로 바꿀까요? 신고자에게 알림이 가요.`)) return;
    const ok = await act.run(() => rpc('admin_update_report', { p_report_id: r.id, p_status: status, p_resolution: note.trim() || null }));
    if (ok) {
      toast('신고 상태를 바꿨어요');
      onDone();
    }
  }
  async function hidePost() {
    if (!r.post_code) return;
    if (note.trim().length < 2) {
      act.setError('숨김 사유를 처리 내용 칸에 적어 주세요.');
      return;
    }
    if (!confirmed('이 게시글을 운영 정책에 따라 숨길까요? 작성자에게 알림이 가요.')) return;
    const ok = await act.run(async () => {
      const post = await rpc<{ id: string }>('get_post', { p_code: r.post_code });
      return rpc('admin_set_post_visibility', { p_post_id: post.id, p_visibility: 'hidden_by_admin', p_reason: note.trim() });
    });
    if (ok) toast('게시글을 숨겼어요');
  }
  const statusLabel = REPORT_STATUS.find((s) => s[0] === r.status)?.[1] ?? r.status;
  return (
    <li className="card stack-sm">
      <div className="row-between">
        <b>#{r.report_no} · {REPORT_REASON_LABEL[r.reason] ?? r.reason}</b>
        <Badge tone={r.status === 'resolved' ? 'green' : r.status === 'rejected' ? 'gray' : 'yellow'}>{statusLabel}</Badge>
      </div>
      {r.detail && <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{r.detail}</p>}
      <dl className="kv">
        <dt>신고자</dt><dd>{r.reporter ?? '-'}</dd>
        <dt>대상</dt><dd>{r.target_kind === 'trade' ? '거래' : r.target_kind === 'post' ? '게시글' : '사용자'} · {r.target_user ?? '-'}</dd>
        <dt>접수</dt><dd>{fmtDateTime(r.created_at)}</dd>
      </dl>
      <div className="row">
        {r.trade_id && (
          <Link className="btn secondary small" href={`/trades/${r.trade_id}`}>
            거래 보기 {r.trade_status && `(${TRADE_STATUS_LABEL[r.trade_status]})`}
          </Link>
        )}
        {r.post_code && (
          <Link className="btn secondary small" href={`/posts/${r.post_code}`}>
            게시글 보기
          </Link>
        )}
      </div>
      <div className="field">
        <label htmlFor={`res-${r.id}`}>처리 내용</label>
        <textarea id={`res-${r.id}`} className="textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="신고자에게도 보이는 내용이에요." />
      </div>
      <ErrorBox error={act.error} />
      <div className="row">
        <button className="btn secondary small" disabled={act.busy} onClick={() => void update('reviewing')}>검토 중</button>
        <button className="btn small" disabled={act.busy} onClick={() => void update('resolved')}>처리 완료</button>
        <button className="btn danger small" disabled={act.busy} onClick={() => void update('rejected')}>반려</button>
        {r.post_code && <button className="btn danger small" disabled={act.busy} onClick={() => void hidePost()}>글 숨기기</button>}
      </div>
    </li>
  );
}

export function ReportsTab() {
  const [status, setStatus] = useState<AdminReport['status']>('received');
  const { data, error, loading, reload } = useLoad(() => rpc<AdminReport[]>('admin_list_reports', { p_status: status }), [status]);
  return (
    <div className="stack">
      <Chips value={status} options={REPORT_STATUS} onChange={setStatus} label="신고 상태" />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && data.length === 0 ? <Empty>해당 상태의 신고가 없어요.</Empty> : (
        <ul className="list">{data?.map((r) => <ReportItem key={r.id} r={r} onDone={reload} />)}</ul>
      )}
    </div>
  );
}

/* ---------- 거래 ---------- */

interface AdminTrade {
  id: string; trade_no: number; kind: 'giveaway' | 'swap'; status: TradeStatus; dispute_reason: string | null;
  stage_deadline_at: string | null; updated_at: string; participants: string[] | null;
  post: { code: string; title: string } | null;
}

const OUTCOMES: [string, string][] = [
  ['resolved_completed', '완료로 확인'],
  ['resolved_unfulfilled', '미이행으로 확인'],
  ['closed_unresolved', '확인 불가로 종료'],
];

function TradeItem({ t, onDone }: { t: AdminTrade; onDone: () => void }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('resolved_unfulfilled');
  const [note, setNote] = useState('');
  const act = useAction();
  const canResolve = t.status === 'disputed' || ['proposed', 'accepted', 'ready', 'transfer_in_progress', 'awaiting_receipt'].includes(t.status);
  async function resolve() {
    if (note.trim().length < 2) {
      act.setError('처리 사유를 적어 주세요.');
      return;
    }
    const label = OUTCOMES.find((o) => o[0] === outcome)?.[1];
    if (!confirmed(`거래 #${t.trade_no}을(를) "${label}"(으)로 정리할까요? 되돌릴 수 없어요.`)) return;
    const ok = await act.run(() => rpc('admin_resolve_trade', { p_trade_id: t.id, p_outcome: outcome, p_note: note.trim() }));
    if (ok) {
      toast('거래를 정리했어요');
      onDone();
    }
  }
  return (
    <li className="card stack-sm">
      <div className="row-between">
        <Link href={`/trades/${t.id}`}><b>#{t.trade_no} · {t.kind === 'giveaway' ? '나눔' : '교환'}</b></Link>
        <TradeStatusBadge status={t.status} />
      </div>
      {t.post && <p className="small">{t.post.title}</p>}
      <p className="faint">
        {(t.participants ?? []).join(' · ')} · {fmtDateTime(t.updated_at)}
        {t.stage_deadline_at && ` · 기한 ${fmtDateTime(t.stage_deadline_at)}`}
      </p>
      {t.dispute_reason && <p className="notice warn small">{DISPUTE_REASON_LABEL[t.dispute_reason] ?? t.dispute_reason}</p>}
      {canResolve && !open && (
        <button className="btn secondary small" onClick={() => setOpen(true)}>정리하기</button>
      )}
      {open && (
        <div className="stack-sm">
          <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="처리 결과">
            {OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="확인한 증빙과 판단 이유(참여자에게 보여요)" maxLength={300} aria-label="처리 사유" />
          <p className="faint">&ldquo;완료로 확인&rdquo;해도 나눔 성장 점수는 주지 않아요(수령 확인된 나눔만 반영).</p>
          <ErrorBox error={act.error} />
          <div className="row">
            <button className="btn small" disabled={act.busy} onClick={() => void resolve()}>정리</button>
            <button className="btn ghost small" onClick={() => setOpen(false)}>닫기</button>
          </div>
        </div>
      )}
    </li>
  );
}

export function TradesTab() {
  const [filter, setFilter] = useState('disputed');
  const { data, error, loading, reload } = useLoad(() => rpc<AdminTrade[]>('admin_list_trades', { p_filter: filter }), [filter]);
  return (
    <div className="stack">
      <Chips value={filter} options={[['disputed', '분쟁'], ['overdue', '기한 지남'], ['active', '진행 중'], ['all', '전체']]} onChange={setFilter} label="거래 필터" />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && data.length === 0 ? <Empty>해당 거래가 없어요.</Empty> : (
        <ul className="list">{data?.map((t) => <TradeItem key={t.id} t={t} onDone={reload} />)}</ul>
      )}
    </div>
  );
}

/* ---------- 회원 ---------- */

interface AdminMember {
  user_id: string; nickname: string; role: string; account_status: 'active' | 'restricted' | 'suspended';
  restricted_until: string | null; status_reason: string | null; created_at: string; badge: BadgeT;
  reports_against: number; trades: number; disputes: number;
}

export function MembersTab() {
  const { toast } = useApp();
  const [q, setQ] = useState('');
  const [member, setMember] = useState<AdminMember | null>(null);
  const [status, setStatus] = useState<AdminMember['account_status']>('active');
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [tradeId, setTradeId] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const find = useAction();
  const act = useAction();

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    const m = await find.run(() => rpc<AdminMember>('admin_find_member', { p_nickname: q.trim() }));
    setMember(m ?? null);
    if (m) {
      setStatus(m.account_status);
      setUntil(toLocalInput(m.restricted_until));
    }
  }
  async function saveStatus() {
    if (!member) return;
    if (reason.trim().length < 2) {
      act.setError('사유를 적어 주세요. 회원에게 알림으로 전달돼요.');
      return;
    }
    if (!confirmed(`${member.nickname}님의 상태를 "${status}"(으)로 바꿀까요?`)) return;
    const ok = await act.run(() => rpc('admin_set_account_status', {
      p_user_id: member.user_id, p_status: status,
      p_until: status === 'restricted' && until ? new Date(until).toISOString() : null, p_reason: reason.trim(),
    }));
    if (ok) {
      toast('계정 상태를 바꿨어요');
      setReason('');
      const m = await rpc<AdminMember>('admin_find_member', { p_nickname: member.nickname }).catch(() => null);
      if (m) setMember(m);
    }
  }
  async function revoke() {
    if (!/^[0-9a-f-]{36}$/i.test(tradeId.trim())) {
      act.setError('거래 ID(거래 화면 주소의 긴 값)를 넣어 주세요.');
      return;
    }
    if (revokeReason.trim().length < 2) {
      act.setError('회수 사유를 적어 주세요.');
      return;
    }
    if (!confirmed('이 거래로 받은 성장 점수를 회수할까요? 회수 기록이 남아요.')) return;
    const r = await act.run(() => rpc<{ revoked: number }>('admin_revoke_progress', { p_trade_id: tradeId.trim(), p_reason: revokeReason.trim() }));
    if (r) toast(r.revoked ? `${r.revoked}건 회수했어요` : '회수할 점수가 없어요(이미 회수됐거나 미지급)');
  }

  return (
    <div className="stack">
      <form className="row" onSubmit={search}>
        <input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="닉네임으로 찾기" aria-label="닉네임" />
        <button className="btn" disabled={find.busy}>찾기</button>
      </form>
      <ErrorBox error={find.error} />
      {member && (
        <div className="card stack-sm">
          <div className="row-between">
            <b>{member.nickname}</b>
            <Badge tone={member.account_status === 'active' ? 'green' : 'red'}>{member.account_status}</Badge>
          </div>
          <dl className="kv">
            <dt>가입</dt><dd>{fmtDateTime(member.created_at)}</dd>
            <dt>성장</dt><dd>{member.badge.level.name} (나눔 {member.badge.level.given}장)</dd>
            <dt>완료 거래</dt><dd>{member.badge.completed_trades}건 · 미이행 {member.badge.unfulfilled}건</dd>
            <dt>거래/분쟁</dt><dd>{member.trades}건 / {member.disputes}건</dd>
            <dt>받은 신고</dt><dd>{member.reports_against}건</dd>
            {member.status_reason && (<><dt>최근 사유</dt><dd>{member.status_reason}</dd></>)}
          </dl>
          <hr className="divider" />
          <div className="field">
            <label htmlFor="m-status">계정 상태</label>
            <select id="m-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as AdminMember['account_status'])}>
              <option value="active">정상</option>
              <option value="restricted">이용 제한(새 참여 불가)</option>
              <option value="suspended">정지</option>
            </select>
          </div>
          {status === 'restricted' && (
            <div className="field">
              <label htmlFor="m-until">제한 종료(비우면 해제할 때까지)</label>
              <input id="m-until" type="datetime-local" className="input" value={until} onChange={(e) => setUntil(e.target.value)} />
            </div>
          )}
          <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(회원에게 알림으로 전달)" aria-label="상태 변경 사유" maxLength={300} />
          <button className="btn secondary" disabled={act.busy} onClick={() => void saveStatus()}>상태 저장</button>
        </div>
      )}
      <div className="card soft stack-sm">
        <h3>성장 점수 회수(허위 거래 확정 시)</h3>
        <input className="input mono" value={tradeId} onChange={(e) => setTradeId(e.target.value)} placeholder="거래 ID" aria-label="거래 ID" />
        <input className="input" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} placeholder="회수 사유" aria-label="회수 사유" />
        <button className="btn danger" disabled={act.busy} onClick={() => void revoke()}>점수 회수</button>
      </div>
      <ErrorBox error={act.error} />
    </div>
  );
}

/* ---------- 스레드 ---------- */

interface ThreadsItem { user_id: string; nickname: string; handle: string; status: string; verify_code: string | null; requested_at: string | null }

export function ThreadsTab() {
  const { toast } = useApp();
  const { data, error, loading, reload } = useLoad(() => rpc<ThreadsItem[]>('admin_list_threads', { p_status: 'pending' }), []);
  const act = useAction();
  async function decide(t: ThreadsItem, approve: boolean) {
    if (!confirmed(`${t.nickname}님(@${t.handle})을 ${approve ? '확인 완료' : '반려'} 처리할까요?`)) return;
    const ok = await act.run(() => rpc('admin_decide_threads', { p_user_id: t.user_id, p_approve: approve }));
    if (ok) {
      toast(approve ? '확인 완료했어요' : '반려했어요');
      void reload();
    }
  }
  return (
    <div className="stack">
      <p className="notice small">공개 프로필 소개글에 인증코드가 보이는지 직접 확인해요. &ldquo;계정 소유 확인&rdquo;일 뿐 실명·거래 안전 인증이 아니에요.</p>
      <ErrorBox error={error ?? act.error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && data.length === 0 ? <Empty>확인 대기 중인 요청이 없어요.</Empty> : (
        <ul className="list">
          {data?.map((t) => (
            <li key={t.user_id} className="card stack-sm">
              <div className="row-between">
                <b>{t.nickname}</b>
                <a href={`https://www.threads.net/@${encodeURIComponent(t.handle)}`} target="_blank" rel="noreferrer">@{t.handle}</a>
              </div>
              <p className="small">인증코드 <b className="mono">{t.verify_code}</b> · {fmtDateTime(t.requested_at)}</p>
              <div className="row">
                <button className="btn small" disabled={act.busy} onClick={() => void decide(t, true)}>확인 완료</button>
                <button className="btn danger small" disabled={act.busy} onClick={() => void decide(t, false)}>반려</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- 설정 ---------- */

interface SettingRow { key: string; value: unknown; description: string; updated_at: string }
interface CampaignRow { slug: string; name: string; starts_at: string; ends_at: string; status: string; notice: string }

function SettingItem({ s, onSaved }: { s: SettingRow; onSaved: () => void }) {
  const { toast } = useApp();
  const [text, setText] = useState(JSON.stringify(s.value, null, s.key === 'levels' ? 1 : 0));
  const act = useAction();
  async function save() {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      act.setError('JSON 형식이 아니에요. 숫자는 그대로, 글자는 "따옴표"로 감싸 주세요.');
      return;
    }
    if (!confirmed(`설정 "${s.key}" 값을 바꿀까요? 감사로그에 남아요.`)) return;
    const ok = await act.run(() => rpc('admin_set_setting', { p_key: s.key, p_value: value }));
    if (ok) {
      toast('저장했어요');
      onSaved();
    }
  }
  const multiline = text.length > 40;
  return (
    <li className="card flat stack-sm" style={{ padding: 12 }}>
      <div className="row-between">
        <b className="mono">{s.key}</b>
        <span className="faint">{fmtDateTime(s.updated_at)}</span>
      </div>
      {s.description && <p className="faint">{s.description}</p>}
      <div className="row">
        {multiline ? (
          <textarea className="textarea mono grow" value={text} onChange={(e) => setText(e.target.value)} aria-label={s.key} />
        ) : (
          <input className="input mono grow" value={text} onChange={(e) => setText(e.target.value)} aria-label={s.key} />
        )}
        <button className="btn secondary small" disabled={act.busy} onClick={() => void save()}>저장</button>
      </div>
      <ErrorBox error={act.error} />
    </li>
  );
}

function CampaignForm({ c, onSaved }: { c: CampaignRow; onSaved: () => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({
    name: c.name, starts_at: toLocalInput(c.starts_at), ends_at: toLocalInput(c.ends_at), status: c.status, notice: c.notice,
  });
  const act = useAction();
  async function save() {
    if (!confirmed(`시즌 "${c.slug}" 정보를 바꿀까요? 상태를 ended로 바꾸면 새 참여가 멈춰요.`)) return;
    const ok = await act.run(() => rpc('admin_update_campaign', {
      p_slug: c.slug,
      p: { name: f.name, starts_at: new Date(f.starts_at).toISOString(), ends_at: new Date(f.ends_at).toISOString(), status: f.status, notice: f.notice },
    }));
    if (ok) {
      toast('시즌 정보를 저장했어요');
      onSaved();
    }
  }
  return (
    <div className="card stack-sm">
      <h3>시즌 · <span className="mono">{c.slug}</span></h3>
      <div className="field"><label htmlFor="c-name">이름</label><input id="c-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="field"><label htmlFor="c-start">시작</label><input id="c-start" type="datetime-local" className="input" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} /></div>
      <div className="field"><label htmlFor="c-end">종료</label><input id="c-end" type="datetime-local" className="input" value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} /></div>
      <div className="field">
        <label htmlFor="c-status">상태</label>
        <select id="c-status" className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="upcoming">upcoming(예정)</option>
          <option value="active">active(진행)</option>
          <option value="ended">ended(종료)</option>
        </select>
      </div>
      <div className="field"><label htmlFor="c-notice">안내 문구</label><textarea id="c-notice" className="textarea" value={f.notice} onChange={(e) => setF({ ...f, notice: e.target.value })} /></div>
      <ErrorBox error={act.error} />
      <button className="btn secondary" disabled={act.busy} onClick={() => void save()}>시즌 저장</button>
    </div>
  );
}

export function SettingsTab() {
  const { data, error, loading, reload } = useLoad(async () => {
    const db = supabase();
    const [s, c] = await Promise.all([
      db.from('app_settings').select('key, value, description, updated_at').order('key'),
      db.from('campaigns').select('slug, name, starts_at, ends_at, status, notice').order('starts_at', { ascending: false }),
    ]);
    if (s.error || c.error) throw new Error(errorMessage(s.error ?? c.error));
    return { settings: (s.data ?? []) as SettingRow[], campaigns: (c.data ?? []) as CampaignRow[] };
  }, []);
  if (loading && !data) return <Loading />;
  return (
    <div className="stack">
      <ErrorBox error={error} onRetry={reload} />
      {data?.campaigns.map((c) => <CampaignForm key={`${c.slug}-${c.status}`} c={c} onSaved={reload} />)}
      <h3>운영 설정</h3>
      <ul className="list">{data?.settings.map((s) => <SettingItem key={`${s.key}-${s.updated_at}`} s={s} onSaved={reload} />)}</ul>
    </div>
  );
}

/* ---------- 감사로그 ---------- */

interface AuditRow { id: number; admin: string | null; action: string; target_kind: string; target_id: string; detail: Record<string, unknown>; created_at: string }

export function AuditTab() {
  const { data, error, loading, reload } = useLoad(() => rpc<AuditRow[]>('admin_audit_logs', { p_limit: 200 }), []);
  if (loading && !data) return <Loading />;
  return (
    <div className="stack">
      <ErrorBox error={error} onRetry={reload} />
      {data && data.length === 0 ? <Empty>아직 기록이 없어요.</Empty> : (
        <ul className="list">
          {data?.map((l) => (
            <li key={l.id} className="card flat stack-sm" style={{ padding: 12 }}>
              <div className="row-between">
                <b>{l.action}</b>
                <span className="faint">{fmtDateTime(l.created_at)}</span>
              </div>
              <p className="faint">{l.admin ?? '시스템'} · {l.target_kind} <span className="mono">{l.target_id}</span></p>
              <p className="mono">{JSON.stringify(l.detail)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
