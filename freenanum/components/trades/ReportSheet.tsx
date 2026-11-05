'use client';

import { useState } from 'react';
import { rpc } from '@/lib/api';
import { REPORT_REASON_LABEL } from '@/lib/format';
import type { ReportReason, TradeStatus } from '@/lib/types';
import { ErrorBox, Sheet, useAction } from '@/components/ui';
import s from './trades.module.css';

const REASONS: ReportReason[] = ['not_sent', 'not_received', 'no_response', 'barcode_misuse', 'fake_trade', 'commercial', 'abuse', 'other'];

export default function ReportSheet({
  open, onClose, tradeId, onDone,
}: { open: boolean; onClose: () => void; tradeId: string; onDone: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const [result, setResult] = useState<{ report_no: number; status: TradeStatus } | null>(null);
  const { busy, error, run } = useAction();

  const close = () => {
    if (result) onDone();
    setResult(null);
    setReason(null);
    setDetail('');
    onClose();
  };

  const submit = () =>
    run(async () => {
      const r = await rpc<{ report_no: number; status: TradeStatus }>('report_trade', {
        p_trade_id: tradeId, p_reason: reason, p_detail: detail.trim(),
      });
      setResult(r);
    });

  return (
    <Sheet open={open} onClose={close} title="문제 신고">
      {result ? (
        <div className="stack">
          <div className="ok-box" role="status">
            신고가 접수됐어요. 접수번호 <b>#{result.report_no}</b>
          </div>
          {result.status === 'disputed' && (
            <p className="small">
              거래가 <b>확인 대기(분쟁)</b>로 넘어갔어요. 운영자가 기록을 확인할 때까지 자동으로 완료되거나 취소되지 않아요.
            </p>
          )}
          <p className="faint">처리 상태는 MY › 신고 내역에서 볼 수 있어요.</p>
          <button className="btn block" onClick={close}>
            확인
          </button>
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: 6 }}>무슨 일이 있었나요?</legend>
            {REASONS.map((r) => (
              <label key={r} className={s.radio}>
                <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
                {REPORT_REASON_LABEL[r]}
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="report-detail">자세한 내용 (선택)</label>
            <textarea
              id="report-detail"
              className="textarea"
              maxLength={1000}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="언제, 어떤 일이 있었는지 적어 주세요. 바코드 번호나 연락처는 적지 마세요."
            />
          </div>
          <p className="notice">
            진행 중인 거래라면 신고하는 즉시 확인 대기(분쟁)로 바뀌고, 운영자가 양쪽 기록을 확인해요. 공식 앱 화면 캡처 같은 증빙은 위조 여부를 확정할 수 없어 참고로만 봐요.
          </p>
          <ErrorBox error={error} />
          <button className="btn terra block" type="submit" disabled={!reason || busy}>
            {busy ? '접수 중…' : '신고 접수'}
          </button>
        </form>
      )}
    </Sheet>
  );
}
