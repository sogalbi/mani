// Small round fairy-tale character. Decorations unlock with the giving level (1–6).
// Every level is cute; higher levels only add a decoration.

export const BODY_COLORS = {
  cream: '#f6e3b8',
  peach: '#f7c9b0',
  mint: '#cfe6c8',
  sky: '#cbe2f0',
  butter: '#f6e09a',
  lilac: '#ddd0ef',
} as const;
export type BodyColor = keyof typeof BODY_COLORS;

export function Avatar({ level = 1, size = 72, label, color = 'cream' }: { level?: number; size?: number; label?: string; color?: BodyColor }) {
  const lv = Math.max(1, Math.min(6, level));
  const body = BODY_COLORS[color] ?? BODY_COLORS.cream;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={label ?? `캐릭터 (${lv}단계 장식)`}
      style={{ display: 'block', flex: 'none' }}
    >
      {/* cape (Lv5+) */}
      {lv >= 5 && <path d="M24 62 Q50 40 76 62 L82 92 Q50 98 18 92 Z" fill="#8fae7f" opacity="0.9" />}
      {/* body */}
      <ellipse cx="50" cy="66" rx="27" ry="24" fill={body} stroke="#3b372f" strokeWidth="2.2" />
      {/* tiny arms and feet */}
      <path d="M24 66 q-7 3 -5 9" fill="none" stroke="#3b372f" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M76 66 q7 3 5 9" fill="none" stroke="#3b372f" strokeWidth="2.2" strokeLinecap="round" />
      <ellipse cx="40" cy="90" rx="6" ry="3.2" fill="#3b372f" />
      <ellipse cx="60" cy="90" rx="6" ry="3.2" fill="#3b372f" />
      {/* face */}
      <circle cx="41" cy="63" r="2.6" fill="#3b372f" />
      <circle cx="59" cy="63" r="2.6" fill="#3b372f" />
      <path d="M46 70 q4 3 8 0" fill="none" stroke="#3b372f" strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="35" cy="70" rx="4" ry="2.4" fill="#eaa48a" opacity="0.7" />
      <ellipse cx="65" cy="70" rx="4" ry="2.4" fill="#eaa48a" opacity="0.7" />
      {/* Lv1 sprout (always) */}
      <path d="M50 43 V32" stroke="#56744f" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M50 35 q-10 -6 -14 -1 q6 6 14 1z" fill="#8fbf7a" stroke="#56744f" strokeWidth="1.6" />
      <path d="M50 33 q10 -7 15 -2 q-7 7 -15 2z" fill="#a4cf8c" stroke="#56744f" strokeWidth="1.6" />
      {/* Lv2 clover on the side */}
      {lv >= 2 && (
        <g transform="translate(70 46)">
          {[0, 90, 180, 270].map((r) => (
            <circle key={r} cx="0" cy="-4" r="3.6" fill="#7fb36b" transform={`rotate(${r})`} />
          ))}
          <circle r="1.6" fill="#56744f" />
        </g>
      )}
      {/* Lv3 bud hairpin */}
      {lv >= 3 && (
        <g transform="translate(30 47)">
          <ellipse rx="4" ry="5.5" fill="#e9a3a0" stroke="#a85a37" strokeWidth="1.2" />
          <path d="M-3 4 q3 3 6 0" fill="#8fbf7a" />
        </g>
      )}
      {/* Lv4 flower crown */}
      {lv >= 4 && (
        <g>
          {[30, 40, 60, 70].map((x, i) => (
            <circle key={x} cx={x} cy={i === 0 || i === 3 ? 49 : 45} r="3.8" fill={i % 2 ? '#f3d27a' : '#f2b5a7'} stroke="#a85a37" strokeWidth="1" />
          ))}
        </g>
      )}
      {/* Lv6 sparkles */}
      {lv >= 6 && (
        <g fill="#f3d27a" stroke="#c99b2f" strokeWidth="0.8">
          <path d="M14 30 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" />
          <path d="M86 26 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6z" />
          <path d="M88 58 l1.2 3 3 1.2 -3 1.2 -1.2 3 -1.2 -3 -3 -1.2 3 -1.2z" />
        </g>
      )}
    </svg>
  );
}
