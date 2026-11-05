import { ImageResponse } from 'next/og';
import { serverAnonClient } from '@/lib/supabase';
import type { PostDetail } from '@/lib/types';

export const alt = '프리나눔 나눔·교환 게시글';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// The bundled OG font has no Korean glyphs and remote fonts are not loaded,
// so the card text is kept to Latin letters and numbers.
const KIND = { GIVEAWAY: 'FREE GIVEAWAY', SWAP: 'STICKER SWAP', REQUEST: 'SOS · LAST STICKER' } as const;

async function load(code: string): Promise<PostDetail | null> {
  if (!/^[A-Za-z0-9]{8}$/.test(code)) return null;
  try {
    const client = serverAnonClient();
    if (!client) return null;
    const { data, error } = await client.rpc('get_post', { p_code: code });
    return error ? null : (data as PostDetail);
  } catch {
    return null;
  }
}

function closing(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
  return `Closes ${parts} KST`;
}

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const post = await load(code);
  const offer = post?.items.filter((i) => i.direction === 'offer') ?? [];
  const want = post?.items.filter((i) => i.direction === 'want') ?? [];
  const fmt = (list: typeof offer) => list.map((i) => `${i.code} x${i.quantity}`).join(' + ');
  const line = !post ? 'e-Frequency sticker sharing' : post.kind === 'SWAP' ? `${fmt(offer)}  <->  ${fmt(want)}` : fmt(post.kind === 'REQUEST' ? want : offer);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          background: '#fbf6ea', padding: 64, fontSize: 40, color: '#3b372f',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', background: '#56744f', color: '#fff', borderRadius: 999, padding: '10px 28px', fontSize: 34, fontWeight: 700 }}>
            {post ? KIND[post.kind] : 'FREENANUM'}
          </div>
          <div style={{ display: 'flex', width: 96, height: 96, borderRadius: 999, background: '#f3d27a', border: '6px solid #3b372f' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', fontSize: 76, fontWeight: 800, color: '#3b372f' }}>{line}</div>
          {post && <div style={{ display: 'flex', fontSize: 40, color: '#6f675a' }}>{closing(post.closes_at)}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', fontSize: 48, fontWeight: 700, color: '#56744f' }}>FREENANUM</div>
          <div style={{ display: 'flex', fontSize: 26, color: '#9a907f' }}>Not an official Starbucks service</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
