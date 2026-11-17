'use client';

import Link from 'next/link';
import { useState } from 'react';
import { rpc } from '@/lib/api';
import { DISPUTE_REASON_LABEL, fmtDateTime, ROLE_LABEL, TRADE_STATUS_LABEL } from '@/lib/format';
import type { TradeDetail } from '@/lib/types';
import { Check, ErrorBox, Sheet, Sticker, useAction } from '@/components/ui';
import { useApp } from '@/components/Providers';
import { Icon } from '@/components/Icon';
import BarcodeReveal from './BarcodeReveal';
import ReportSheet from './ReportSheet';
import { BARCODE_TEXT, canFlags, infoDone, myself, peers, threadsUrl, TRADE_RISK_TEXT, waitingText } from './util';

type Props = { t: TradeDetail; onChanged: () => Promise<void> | void };

export default function ActionPanel({ t, onChanged }: Props) {
  const can = canFlags(t);
  const [sheet, setSheet] = useState<null | 'sent' | 'receipt' | 'cancel' | 'report'>(null);
  const close = () => setSheet(null);

  if (!t.me) {
    return (
      <div className="notice">운영자 보기예요. 바코드 번호는 운영자 화면에 표시되지 않아요.</div>
    );
  }

  const waiting = waitingText(t);
  const mine = myself(t);
  const infoNeeded = can.submit_info && !(mine && infoDone(mine));
  const hasStep = infoNeeded || can.confirm_peer || can.reveal_barcode || can.declare_sent || can.confirm_receipt;

  return (
    <section className="stack" aria-labelledby="todo-title">
      <h2 id="todo-title">{hasStep ? '지금 할 일' : '진행 상황'}</h2>
      <StatusInfo t={t} />
      <InfoStep t={t} onChanged={onChanged} />
      {can.confirm_peer && <PeerStep t={t} onChanged={onChanged} />}
      {(can.reveal_barcode || can.declare_sent) && <SendStep t={t} onChanged={onChanged} onDeclare={() => setSheet('sent')} />}
      {can.confirm_receipt && (
        <div className="card butter stack">
          <h3>스티커가 들어왔나요?</h3>
          <p className="small">상대가 보냈다고 신고했어요. 공식 앱에서 스티커가 들어온 것을 확인한 뒤 눌러 주세요.</p>
          <button className="btn block" onClick={() => setSheet('receipt')}>
            <Icon name="check" size={18} /> 받았어요
          </button>
        </div>
      )}
      {!hasStep && waiting && <div className="card soft small">{waiting}</div>}

      <div className="row">
        {can.cancel && (
          <button className="btn secondary small" onClick={() => setSheet('cancel')}>
            {cancelLabel(t)}
          </button>
        )}
        <button className="btn danger small" onClick={() => setSheet('report')}>
          <Icon name="flag" size={16} /> 문제 신고
        </button>
      </div>

      <DeclareSheet open={sheet === 'sent'} onClose={close} t={t} onChanged={onChanged} />
      <ReceiptSheet open={sheet === 'receipt'} onClose={close} t={t} onChanged={onChanged} />
      <CancelSheet open={sheet === 'cancel'} onClose={close} t={t} onChanged={onChanged} />
      <ReportSheet open={sheet === 'report'} onClose={close} tradeId={t.id} onDone={() => void onChanged()} />
    </section>
  );
}

function StatusInfo({ t }: { t: TradeDetail }) {
  switch (t.status) {
    case 'disputed':
      return (
        <div className="card danger stack-sm">
          <h3>확인 대기(분쟁) 중이에요</h3>
          {t.dispute_reason && <p className="small">사유: {DISPUTE_REASON_LABEL[t.dispute_reason] ?? t.dispute_reason}</p>}
          <p className="small">
            운영자가 기록을 확인할 때까지 자동으로 완료되거나 취소되지 않아요. 더 알릴 내용이 있으면 문제 신고로 남겨 주세요.
          </p>
        </div>
      );
    case 'completed':
      return (
        <div className="ok-box">
          <b>완료됐어요!</b> {fmtDateTime(t.completed_at)}
          {t.kind === 'giveaway' && t.me?.role === 'giver' && ' · 나눔 장수가 성장 기록에 반영됐어요.'}
          {t.kind === 'giveaway' && t.me?.role === 'receiver' && ' · 감사한 마음을 전해 보세요.'}
        </div>
      );
    case 'resolved_completed':
    case 'resolved_unfulfilled':
    case 'closed_unresolved':
      return (
        <div className="card soft stack-sm">
          <h3>운영자가 정리한 거래예요</h3>
          <p className="small">결과: {TRADE_STATUS_LABEL[t.status]}</p>
          {t.close_reason && <p className="small">메모: {t.close_reason}</p>}
          <p className="faint">결과에 이의가 있으면 문제 신고로 남겨 주세요.</p>
        </div>
      );
    case 'expired':
    case 'canceled':
    case 'rejected':
      return (
        <div className="card soft small">
          <b>{TRADE_STATUS_LABEL[t.status]}</b>
          {t.close_reason ? ` · ${t.close_reason}` : ''} {t.closed_at && <span className="faint">({fmtDateTime(t.closed_at)})</span>}
        </div>
      );
    default:
      if (t.deadline_passed)
        return <div className="notice warn">이 단계의 기한이 지났어요. 곧 규칙에 따라 자동으로 정리돼요.</div>;
      return null;
  }
}

const HANDLE_RE = /^[A-Za-z0-9_.]{1,30}$/;

/** Step 1: every participant enters their Threads ID; receivers also enter the barcode. */
function InfoStep({ t, onChanged }: Props) {
  const { me, refreshMe, toast } = useApp();
  const mine = myself(t);
  const receives = Boolean(t.me?.receives);
  const canEdit = Boolean(canFlags(t).submit_info);
  const submitted = mine ? infoDone(mine) : false;
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState(mine?.threads_handle ?? me?.threads?.handle ?? '');
  const [barcode, setBarcode] = useState('');
  const [ok, setOk] = useState(false);
  const { busy, error, run } = useAction();
  const giveawayReceiver = t.kind === 'giveaway' && t.me?.role === 'receiver';
  const cleanHandle = handle.trim().replace(/^@/, '');
  const digits = barcode.replace(/[\s-]/g, '');
  const valid = HANDLE_RE.test(cleanHandle) && (!receives || /^\d{8,24}$/.test(digits));

  const summary = submitted && mine ? (
    <div className="card soft stack-sm">
      <div className="row-between">
        <span className="label">내가 입력한 정보</span>
        {canEdit && !editing && (
          <button className="btn ghost small" onClick={() => setEditing(true)}>
            수정하기
          </button>
        )}
      </div>
      <p className="small">
        스레드 <b>@{mine.threads_handle}</b>
      </p>
      {receives && t.my_barcode?.submitted && (
        <>
          <p className="small">
            바코드 <span className="mono">끝자리 ••{t.my_barcode.last4}</span> · 상대 열람 {t.my_barcode.view_count}/{t.barcode_view_limit}회
            {t.my_barcode.last_viewed_at && ` · 마지막 열람 ${fmtDateTime(t.my_barcode.last_viewed_at)}`}
          </p>
          <p className="faint">
            {t.my_barcode.purged
              ? '더 필요 없어져서 서버에서 바코드 원문을 삭제했어요.'
              : '암호화해서 보관하고, 서로 확인이 끝난 뒤 이 거래의 보내는 사람에게만 보여요.'}
          </p>
        </>
      )}
    </div>
  ) : null;

  if (!canEdit || (submitted && !editing)) return summary;

  return (
    <>
      {editing && summary}
      <form
        className="card butter stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await rpc('submit_trade_info', {
              p_trade_id: t.id,
              p_threads_handle: cleanHandle,
              p_barcode: receives ? digits : null,
              p_consent: true,
            });
            setBarcode('');
            setOk(false);
            setEditing(false);
            toast('정보를 저장했어요');
            await onChanged();
            void refreshMe();
          });
        }}
      >
        <h3>{giveawayReceiver ? '받을 건가요? 정보를 입력해 주세요' : '거래 정보를 입력해 주세요'}</h3>
        {giveawayReceiver && (
          <p className="small">
            무료 나눔은 받는 분이 보내는 스티커가 없어요. 기한 안에 입력하지 않으면 다음 예비 당첨자에게 기회가 넘어갈 수 있어요.
          </p>
        )}
        {editing && <p className="notice warn">정보를 바꾸면 모든 참여자의 &quot;서로 확인&quot;이 처음부터 다시 진행돼요.</p>}
        <div className="field">
          <label htmlFor="trade-threads">내 스레드(Threads) 아이디</label>
          <input
            id="trade-threads"
            className="input"
            value={handle}
            maxLength={31}
            placeholder="@아이디"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setHandle(e.target.value)}
            required
          />
          <span className="hint">상대가 스레드에서 나를 확인할 때 써요. 영문·숫자·_ . 30자 이내.</span>
        </div>
        {receives && (
          <div className="field">
            <label htmlFor="barcode">받을 프리퀀시 바코드 번호</label>
            <input
              id="barcode"
              className="input mono"
              inputMode="numeric"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={40}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value.replace(/[^\d\s-]/g, ''))}
              placeholder="숫자만 입력"
              required
            />
            <span className="hint">
              스타벅스 앱의 e-프리퀀시 화면에서 선물받기용 바코드 번호를 확인해 붙여넣어 주세요. 공식 앱 화면 구성은 바뀔 수 있어요. 게시글·댓글·스레드에는 절대 올리지 마세요.
            </span>
          </div>
        )}
        <p className="notice warn">{TRADE_RISK_TEXT}</p>
        {receives && <p className="notice warn">{BARCODE_TEXT}</p>}
        <Check checked={ok} onChange={setOk}>
          {receives
            ? '위 안내를 읽었고, 이 거래의 보내는 사람에게만 바코드 번호를 제공하는 데 동의해요.'
            : '위 안내를 읽었고, 조건대로 진행할게요.'}
        </Check>
        <ErrorBox error={error} />
        <div className="row">
          <button className="btn grow" type="submit" disabled={!ok || busy || !valid}>
            {busy ? '저장 중…' : giveawayReceiver ? '받을게요' : '입력 완료'}
          </button>
          {editing && (
            <button className="btn secondary" type="button" onClick={() => setEditing(false)}>
              취소
            </button>
          )}
        </div>
      </form>
    </>
  );
}

/** Step 2: everyone checks the counterpart's Threads ID before any barcode opens. */
function PeerStep({ t, onChanged }: Props) {
  const { refreshMe, toast } = useApp();
  const { busy, error, run } = useAction();
  const others = peers(t).filter((p) => !p.is_me);
  return (
    <div className="card butter stack">
      <h3>상대 스레드 아이디를 확인해 주세요</h3>
      <ul className="list">
        {others.map((o) => (
          <li key={o.user_id} className="row-between">
            <span>
              <b>{o.nickname}</b>
              <span className="faint"> · {ROLE_LABEL[o.role]}</span>
            </span>
            {o.threads_handle ? (
              <a className="btn secondary small" href={threadsUrl(o.threads_handle)} target="_blank" rel="noopener noreferrer">
                @{o.threads_handle} 열기 ↗
              </a>
            ) : (
              <span className="faint">미입력</span>
            )}
          </li>
        ))}
      </ul>
      <p className="small">
        스레드에서 DM 등으로 서로 맞는 사람인지 확인한 뒤 눌러 주세요. 모두 확인하면 보내는 사람에게 바코드가 열려요.
      </p>
      <p className="faint">이상하면 누르지 말고 문제 신고나 취소를 해 주세요. 바코드 번호는 DM으로 주고받지 마세요.</p>
      <p className="faint">
        확인하면 상대 닉네임과 스레드 아이디가 <Link href="/me/contacts">MY › 거래 상대</Link>에 자동 저장돼요.
      </p>
      <ErrorBox error={error} />
      <button
        className="btn block"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await rpc('confirm_peer', { p_trade_id: t.id });
            toast('확인했어요 · 상대 정보를 MY › 거래 상대에 저장했어요');
            await onChanged();
            void refreshMe();
          })
        }
      >
        <Icon name="check" size={18} /> {busy ? '처리 중…' : '상대 스레드 아이디 확인했어요'}
      </button>
    </div>
  );
}

function SendStep({ t, onChanged, onDeclare }: Props & { onDeclare: () => void }) {
  const can = canFlags(t);
  const meId = t.participants.find((p) => p.is_me)?.user_id;
  const owners = Array.from(new Set(t.items.filter((i) => i.sender_id === meId).map((i) => i.receiver_id)));
  const nick = (id: string) => t.participants.find((p) => p.user_id === id)?.nickname ?? '받는 분';
  const giving = t.items.filter((i) => i.sender_id === meId);
  return (
    <div className="card butter stack">
      <h3>공식 앱에서 선물해 주세요</h3>
      <div className="row" style={{ gap: 6 }}>
        {giving.map((i) => (
          <span key={i.seq} className="row" style={{ gap: 4 }}>
            <Sticker code={i.code} name={i.name} quantity={i.quantity} />
            <span className="faint">→ {i.receiver}</span>
          </span>
        ))}
      </div>
      <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
        <li>아래에서 받는 분의 바코드 번호를 열어요.</li>
        <li>스타벅스 공식 앱에서 위 스티커를 그 번호로 선물해요.</li>
        <li>선물을 마쳤다면 &quot;보냈어요&quot;를 눌러요.</li>
      </ol>
      {can.reveal_barcode &&
        owners.map((o) => (
          <BarcodeReveal
            key={o}
            tradeId={t.id}
            ownerId={o}
            ownerNickname={nick(o)}
            limit={t.barcode_view_limit}
            onRevealed={() => void onChanged()}
          />
        ))}
      {can.declare_sent && (
        <button className="btn terra block" onClick={onDeclare}>
          <Icon name="gift" size={18} /> 보냈어요
        </button>
      )}
    </div>
  );
}

function ConfirmSheet({
  open, onClose, title, children, confirmLabel, action, tone = '', dismissLabel = '아직이에요',
}: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; confirmLabel: string;
  action: () => Promise<void>; tone?: string; dismissLabel?: string;
}) {
  const { busy, error, run } = useAction();
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="stack">
        {children}
        <ErrorBox error={error} />
        <button
          className={`btn block ${tone}`}
          disabled={busy}
          onClick={() =>
            run(async () => {
              await action();
              onClose();
            })
          }
        >
          {busy ? '처리 중…' : confirmLabel}
        </button>
        <button className="btn secondary block" onClick={onClose}>
          {dismissLabel}
        </button>
      </div>
    </Sheet>
  );
}

type SheetProps = { open: boolean; onClose: () => void } & Props;

function DeclareSheet({ open, onClose, t, onChanged }: SheetProps) {
  const { refreshMe, toast } = useApp();
  return (
    <ConfirmSheet
      open={open}
      onClose={onClose}
      title="공식 앱에서 선물을 마쳤나요?"
      confirmLabel="네, 보냈어요"
      tone="terra"
      action={async () => {
        await rpc('declare_sent', { p_trade_id: t.id });
        toast('전송 신고를 남겼어요');
        await onChanged();
        void refreshMe();
      }}
    >
      <p className="small">
        &quot;보냈어요&quot;는 내가 보냈다는 <b>신고</b>예요. 프리나눔은 공식 앱의 실제 전송을 확인하지 않고, 받는 분이 수령을 확인해야 완료돼요.
      </p>
      <p className="notice warn">아직 보내지 않았다면 누르지 마세요. 신고한 뒤에는 바코드를 다시 볼 수 없어요.</p>
    </ConfirmSheet>
  );
}

function ReceiptSheet({ open, onClose, t, onChanged }: SheetProps) {
  const { refreshMe, toast } = useApp();
  const meId = t.participants.find((p) => p.is_me)?.user_id;
  const incoming = t.items.filter((i) => i.receiver_id === meId);
  return (
    <ConfirmSheet
      open={open}
      onClose={onClose}
      title="스티커가 들어온 것을 확인했나요?"
      confirmLabel="네, 받았어요"
      action={async () => {
        await rpc('confirm_receipt', { p_trade_id: t.id });
        toast('수령 확인을 남겼어요');
        await onChanged();
        void refreshMe();
      }}
    >
      <div className="row" style={{ gap: 6 }}>
        {incoming.map((i) => (
          <span key={i.seq} className="row" style={{ gap: 4 }}>
            <span className="faint">{i.sender} →</span>
            <Sticker code={i.code} name={i.name} quantity={i.quantity} />
          </span>
        ))}
      </div>
      <p className="small">
        공식 앱에서 위 스티커가 들어온 것을 확인한 뒤 눌러 주세요. 확인하면 완료로 기록되고 되돌릴 수 없어요.
      </p>
      <p className="faint">아직 안 들어왔다면 조금 기다려 보고, 문제가 있으면 &quot;문제 신고&quot;를 눌러 주세요.</p>
    </ConfirmSheet>
  );
}

function cancelLabel(t: TradeDetail): string {
  const notAccepted = t.status === 'proposed' && !t.me?.accepted_at;
  if (t.kind === 'giveaway' && t.me?.role === 'receiver' && (t.origin === 'draw' || t.origin === 'manual_pick')) return '당첨 포기';
  if (notAccepted) return '거절하기';
  return '거래 취소';
}

function cancelExplain(t: TradeDetail): string {
  if (t.status === 'transfer_in_progress') return '아무도 전송 신고를 하지 않은 채 기한이 지나 취소할 수 있어요.';
  if (t.kind === 'giveaway' && t.me?.role === 'receiver') {
    if (t.origin === 'draw' || t.origin === 'manual_pick')
      return '포기하면 이 당첨은 취소되고, 예비 당첨자가 있다면 다음 순서에게 기회가 넘어가요. 되돌릴 수 없어요.';
    return '거절하면 나눔을 제안한 분에게 알림이 가요.';
  }
  if (t.kind === 'giveaway') return '취소하면 받는 분에게 알림이 가고, 취소 기록이 거래 이력에 남아요.';
  if (t.status === 'proposed' && !t.me?.accepted_at) return '제안을 거절하면 상대에게 알림이 가요.';
  return '교환을 취소하면 상대에게 알림이 가고, 취소 기록이 거래 이력에 남아요.';
}

function CancelSheet({ open, onClose, t, onChanged }: SheetProps) {
  const [reason, setReason] = useState('');
  const { refreshMe } = useApp();
  return (
    <ConfirmSheet
      open={open}
      onClose={onClose}
      title={`${cancelLabel(t)}할까요?`}
      confirmLabel={cancelLabel(t)}
      tone="danger"
      dismissLabel="닫기"
      action={async () => {
        await rpc('cancel_trade', { p_trade_id: t.id, p_reason: reason.trim() || null });
        await onChanged();
        void refreshMe();
      }}
    >
      <p className="small">{cancelExplain(t)}</p>
      <div className="field">
        <label htmlFor="cancel-reason">사유 (선택)</label>
        <input id="cancel-reason" className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </ConfirmSheet>
  );
}
