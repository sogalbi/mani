'use client';

import { useState } from 'react';
import { rpc } from '@/lib/api';
import { REPORT_REASON_LABEL } from '@/lib/format';
import type { ReportReason } from '@/lib/types';
import { ErrorBox, Sheet, useAction } from '@/components/ui';
import { useApp } from '@/components/Providers';

const POST_REASONS: ReportReason[] = ['commercial', 'spam', 'abuse', 'fake_trade', 'barcode_misuse', 'other'];

export default function ReportSheet({ open, onClose, postId }: { open: boolean; onClose: () => void; postId: string }) {
  const { toast } = useApp();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const { busy, error, run } = useAction();

  const submit = () =>
    run(async () => {
      const r = await rpc<{ report_no: number }>('report_target', {
        p_kind: 'post', p_target: postId, p_reason: reason, p_detail: detail.trim(),
      });
      toast(`신고 #${r.report_no} 접수됐어요. MY > 신고 내역에서 처리 상태를 볼 수 있어요.`);
      setReason(null);
      setDetail('');
      onClose();
    });

  return (
    <Sheet open={open} onClose={onClose} title="게시글 신고">
      <div className="stack-sm" role="radiogroup" aria-label="신고 사유">
        {POST_REASONS.map((r) => (
          <label key={r} className="check">
            <input type="radio" name="report-reason" checked={reason === r} onChange={() => setReason(r)} />
            <span className="small">{REPORT_REASON_LABEL[r]}</span>
          </label>
        ))}
      </div>
      <div className="field">
        <label htmlFor="report-detail">자세한 내용 (선택)</label>
        <textarea
          id="report-detail"
          className="textarea"
          maxLength={1000}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="바코드 번호 같은 민감한 정보는 적지 말아 주세요."
        />
      </div>
      <ErrorBox error={error} />
      <button className="btn block" disabled={!reason || busy} onClick={submit}>
        {busy ? '접수 중…' : '신고 접수'}
      </button>
      <p className="faint">신고는 운영자가 확인해요. 상대를 공개적으로 비난하는 용도로는 쓰지 않아요.</p>
    </Sheet>
  );
}
