import type { Level } from '@/lib/types';
import s from './me.module.css';

export default function LevelProgress({ level }: { level: Level }) {
  const next = level.next;
  if (!next) return <p className="small">가장 높은 단계예요. 고마운 마음이 가득 모였어요 ✨</p>;
  const span = Math.max(1, next.min - level.min);
  const pct = Math.min(100, Math.round(((level.given - level.min) / span) * 100));
  return (
    <div className="stack-sm">
      <div className={s.bar} role="progressbar" aria-valuemin={level.min} aria-valuemax={next.min} aria-valuenow={level.given} aria-label="다음 단계까지">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="faint">
        다음 단계 <b>{next.name}</b>까지 나눔 {Math.max(0, next.min - level.given)}장 · 열리는 장식: {next.deco}
      </p>
    </div>
  );
}
