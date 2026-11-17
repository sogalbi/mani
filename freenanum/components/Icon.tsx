// Small line icons (inline SVG, inherit currentColor).
const PATHS = {
  home: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5M10 20v-5h4v5',
  board: 'M4 5h16v14H4zM8 9h8M8 13h8M8 17h5',
  match: 'M7 7h10l-3-3M17 17H7l3 3M17 7v4M7 17v-4',
  trade: 'M4 7h13l-3-3M20 17H7l3 3',
  me: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17.5v.01',
  shield: 'M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z',
  back: 'M15 5l-7 7 7 7',
  share: 'M12 4v11M8 8l4-4 4 4M5 13v6h14v-6',
  plus: 'M12 5v14M5 12h14',
  flag: 'M5 21V4h11l-2 4 2 4H5',
  copy: 'M8 8h11v11H8zM5 16V5h11',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  gift: 'M4 10h16v4H4zM6 14h12v6H6zM12 10v10M12 10c-2-4-6-4-6-1.5S10 10 12 10zm0 0c2-4 6-4 6-1.5S14 10 12 10z',
  check: 'M5 12.5 10 17l9-10',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14M15 6v14',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
