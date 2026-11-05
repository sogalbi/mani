import Link from 'next/link';
import { KIND_LABEL, METHOD_LABEL, fmtRemaining } from '@/lib/format';
import type { PostCard as Post } from '@/lib/types';
import { Badge, PostStatusBadge, Sticker } from './ui';

export default function PostCard({ post }: { post: Post }) {
  const offer = post.items.filter((i) => i.direction === 'offer');
  const want = post.items.filter((i) => i.direction === 'want');
  const kindTone = post.kind === 'GIVEAWAY' ? 'green' : post.kind === 'SWAP' ? 'yellow' : 'terra';
  return (
    <Link href={`/posts/${post.code}`} className="card stack-sm" style={{ padding: 14 }}>
      <div className="row-between">
        <div className="row" style={{ gap: 6 }}>
          <Badge tone={kindTone}>{KIND_LABEL[post.kind]}</Badge>
          <PostStatusBadge status={post.status} />
        </div>
        <span className="faint">{post.status === 'open' ? fmtRemaining(post.closes_at) : ''}</span>
      </div>
      <h3 style={{ fontSize: '1.02rem' }}>{post.title}</h3>
      <div className="row" style={{ gap: 6 }}>
        {offer.map((i) => (
          <Sticker key={`o${i.code}`} code={i.code} name={i.name} quantity={i.quantity} />
        ))}
        {post.kind === 'SWAP' && <span aria-label="와 교환">⇄</span>}
        {want.map((i) => (
          <Sticker key={`w${i.code}`} code={i.code} name={post.kind === 'REQUEST' ? `${i.name} 필요` : i.name} quantity={i.quantity} />
        ))}
      </div>
      <div className="row-between faint">
        <span>
          {post.author.nickname} · {post.author.level.name}
        </span>
        {post.giveaway && (
          <span>
            {METHOD_LABEL[post.giveaway.method]} · 신청 {post.giveaway.entries_count}명
          </span>
        )}
      </div>
    </Link>
  );
}
