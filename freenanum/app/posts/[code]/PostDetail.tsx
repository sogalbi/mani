'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { rpc } from '@/lib/api';
import { fmtDateTime, KIND_LABEL, siteUrl, stickerSummary } from '@/lib/format';
import type { PostDetail as Post } from '@/lib/types';
import {
  Badge, Countdown, ErrorBox, Loading, PageHeader, PostStatusBadge, shareOrCopy, Sticker, useAction, useLoad,
} from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useApp } from '@/components/Providers';
import AuthorCard from '@/components/posts/AuthorCard';
import GiveawayPanel from '@/components/posts/GiveawayPanel';
import ReportSheet from '@/components/posts/ReportSheet';
import { RequestPanel, SwapPanel } from '@/components/posts/TradeOffers';

export default function PostDetail({ code }: { code: string }) {
  return (
    <Suspense fallback={<Loading lines={3} />}>
      <Detail code={code} />
    </Suspense>
  );
}

function shareText(post: Post): string {
  const items = stickerSummary(post.items);
  const verb = post.kind === 'REQUEST' ? `${items} 필요해요` : post.kind === 'SWAP' ? `교환 ${items.replace(' + ', ' ⇄ ')}` : `${items} 나눔`;
  return `[프리나눔] ${KIND_LABEL[post.kind]} · ${verb} · ${fmtDateTime(post.closes_at)} 마감`;
}

function Detail({ code }: { code: string }) {
  const { session, me, ready, configured, toast } = useApp();
  const created = useSearchParams()?.get('created') === '1';
  const [reportOpen, setReportOpen] = useState(false);
  const { data: post, error, loading, reload } = useLoad(
    () => rpc<Post>('get_post', { p_code: code }),
    [code, session?.user.id, ready],
  );
  const hide = useAction();

  if (!configured) return <ErrorBox error="서버 연결 설정이 없어 게시글을 불러올 수 없어요." />;
  if (loading && !post) return <Loading lines={3} />;
  if (error && !post) {
    return (
      <div className="stack">
        <PageHeader title="게시글" back="/posts" />
        <ErrorBox error={error} onRetry={reload} />
      </div>
    );
  }
  if (!post) return null;

  const url = `${siteUrl() || (typeof window !== 'undefined' ? window.location.origin : '')}/posts/${post.code}`;
  const share = async () => {
    const r = await shareOrCopy(`${url}?utm_source=threads&utm_medium=share`, shareText(post));
    if (r === 'copied') toast('링크와 소개 문구를 복사했어요. 스레드에 붙여 넣어 보세요.');
    if (r === 'failed') toast('복사하지 못했어요. 주소창의 링크를 직접 복사해 주세요.');
  };
  const member = Boolean(session && me && !me.needs_profile);
  const kindTone = post.kind === 'GIVEAWAY' ? 'green' : post.kind === 'SWAP' ? 'yellow' : 'terra';

  return (
    <div className="stack">
      <PageHeader
        title={KIND_LABEL[post.kind]}
        back="/posts"
        right={
          <button className="icon-btn" onClick={share} aria-label="공유하기">
            <Icon name="share" />
          </button>
        }
      />

      {created && (
        <div className="ok-box stack-sm">
          <strong>글을 올렸어요 🌱</strong>
          <span className="small">스레드에 링크를 공유하면 더 많은 분이 볼 수 있어요. 공유 문구에는 종류·장수·마감만 들어가요.</span>
          <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={share}>
            공유 링크 복사
          </button>
        </div>
      )}

      {post.visibility !== 'public' && (
        <div className="notice warn">
          {post.visibility === 'hidden_by_admin' ? '운영 정책에 따라 숨겨진 글이에요. 나만 볼 수 있어요.' : '숨긴 글이에요. 나만 볼 수 있어요.'}
        </div>
      )}

      <article className="card stack">
        <div className="row-between">
          <div className="row" style={{ gap: 6 }}>
            <Badge tone={kindTone}>{KIND_LABEL[post.kind]}</Badge>
            <PostStatusBadge status={post.status} />
          </div>
          {post.status === 'open' && (
            <span className="faint">
              <Countdown to={post.closes_at} />
            </span>
          )}
        </div>
        <h2 style={{ fontSize: '1.3rem' }}>{post.title}</h2>
        <div className="row" style={{ gap: 6 }}>
          {post.items.map((i) => (
            <Sticker
              key={`${i.direction}${i.code}`}
              code={i.code}
              name={post.kind === 'SWAP' ? `${i.direction === 'offer' ? '드림' : '원함'} ${i.name}` : post.kind === 'REQUEST' ? `${i.name} 필요` : i.name}
              quantity={i.quantity}
            />
          ))}
        </div>
        {post.body && <p style={{ whiteSpace: 'pre-wrap' }}>{post.body}</p>}
        <p className="faint">
          {fmtDateTime(post.created_at)} 등록 · {fmtDateTime(post.closes_at)} 마감
        </p>
        {post.status_note && post.kind !== 'GIVEAWAY' && <p className="small muted">{post.status_note}</p>}
      </article>

      <AuthorCard badge={post.author} label={post.kind === 'REQUEST' ? '요청한 사람' : '올린 사람'} />

      {post.kind === 'GIVEAWAY' && post.giveaway && <GiveawayPanel post={post} reload={reload} />}
      {post.kind === 'REQUEST' && <RequestPanel post={post} reload={reload} />}
      {post.kind === 'SWAP' && <SwapPanel post={post} reload={reload} />}

      <div className="notice">
        프리나눔은 스타벅스가 직접 운영하거나 보증하는 공식 서비스가 아니에요. 실제 e-스티커 선물은 스타벅스 공식 앱에서 직접 진행해요.
        바코드 번호는 게시글·댓글에 절대 올리지 말아 주세요.
      </div>

      <div className="row" style={{ justifyContent: 'center' }}>
        {post.is_author && post.visibility === 'public' && (
          <button
            className="btn ghost small"
            disabled={hide.busy}
            onClick={() =>
              hide.run(async () => {
                if (!window.confirm('글을 숨길까요? 진행 중인 거래와 기록은 그대로 남아요.')) return;
                await rpc('close_my_post', { p_post_id: post.id, p_hide: true });
                toast('글을 숨겼어요');
                reload();
              })
            }
          >
            글 숨기기
          </button>
        )}
        {!post.is_author && member && (
          <button className="btn ghost small" onClick={() => setReportOpen(true)}>
            <Icon name="flag" size={18} /> 게시글 신고
          </button>
        )}
      </div>
      <ErrorBox error={hide.error} />
      {member && !post.is_author && <ReportSheet open={reportOpen} onClose={() => setReportOpen(false)} postId={post.id} />}
    </div>
  );
}
