import { DISPUTE_REASON_LABEL, EVENT_LABEL, fmtDateTime, REPORT_REASON_LABEL, TRADE_STATUS_LABEL } from '@/lib/format';
import type { ReportReason, TradeDetail, TradeEvent, TradeStatus } from '@/lib/types';

const EXTRA_LABEL: Record<string, string> = {
  info_submitted: '정보 입력 (바코드는 암호화 저장)',
  info_updated: '정보 수정 → 서로 확인을 처음부터 다시',
  peer_confirmed: '상대 스레드 아이디 확인',
};

function describe(e: TradeEvent, t: TradeDetail): string {
  const m = e.meta ?? {};
  const label = EVENT_LABEL[e.type] ?? EXTRA_LABEL[e.type] ?? e.type;
  switch (e.type) {
    case 'status_changed': {
      const from = TRADE_STATUS_LABEL[m.from as TradeStatus] ?? String(m.from ?? '');
      const to = TRADE_STATUS_LABEL[m.to as TradeStatus] ?? String(m.to ?? '');
      const reason = m.reason ? ` (${DISPUTE_REASON_LABEL[String(m.reason)] ?? String(m.reason)})` : '';
      return `${from} → ${to}${reason}`;
    }
    case 'trade_created': {
      const origin: Record<string, string> = {
        draw: '추첨 당첨', manual_pick: '나눔자 직접 선정', request_offer: '나눔 요청에 제안', swap_proposal: '교환 제안',
      };
      const rank = typeof m.rank === 'number' && m.rank > 0 ? ` · ${m.rank}순위` : '';
      return `${label} (${origin[String(m.origin)] ?? '거래'}${rank})`;
    }
    case 'unfulfilled_by_sender': {
      const who = t.participants.find((p) => p.user_id === m.user_id)?.nickname;
      return `${label}${who ? ` · ${who}` : ''}`;
    }
    case 'problem_reported':
      return `${label} · 접수번호 #${String(m.report_no ?? '')} · ${REPORT_REASON_LABEL[m.reason as ReportReason] ?? ''}`;
    case 'cancel_requested':
      return `${label}${m.reason ? ` · ${String(m.reason)}` : ''}`;
    case 'admin_resolution':
      return `${label} · ${TRADE_STATUS_LABEL[m.outcome as TradeStatus] ?? ''}${m.note ? ` · ${String(m.note)}` : ''}`;
    case 'deadline_passed':
      return `${label} (${TRADE_STATUS_LABEL[m.stage as TradeStatus] ?? ''})`;
    default:
      return label;
  }
}

export default function Timeline({ t }: { t: TradeDetail }) {
  const events = t.events ?? [];
  return (
    <section className="card stack" aria-labelledby="tl">
      <h2 id="tl">기록</h2>
      <p className="faint">기록은 지우거나 고칠 수 없게 쌓여요. 바코드 번호는 기록에 남지 않아요.</p>
      <ol className="timeline">
        {events.map((e) => (
          <li key={e.id}>
            <div>{describe(e, t)}</div>
            <div className="faint">
              {e.actor ?? '시스템'} · {fmtDateTime(e.at)}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
