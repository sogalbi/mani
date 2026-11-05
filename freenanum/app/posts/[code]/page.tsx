import type { Metadata } from 'next';
import { serverAnonClient } from '@/lib/supabase';
import { fmtDateTime, KIND_LABEL, stickerSummary } from '@/lib/format';
import type { PostDetail as Post } from '@/lib/types';
import PostDetail from './PostDetail';

type Props = { params: Promise<{ code: string }> };

const CODE_RE = /^[A-Za-z0-9]{8}$/;

async function fetchPublicPost(code: string): Promise<Post | null> {
  if (!CODE_RE.test(code)) return null;
  const client = serverAnonClient();
  if (!client) return null;
  try {
    const { data, error } = await client.rpc('get_post', { p_code: code });
    return error ? null : (data as Post);
  } catch {
    return null;
  }
}

// Share card: only kind, sticker type/quantity, closing time and the link (spec §4).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const post = await fetchPublicPost(code);
  if (!post) {
    return { title: '나눔·교환 게시글', robots: { index: false } };
  }
  const items = stickerSummary(post.items);
  const title = `${KIND_LABEL[post.kind]} · ${items}`;
  const description = `${fmtDateTime(post.closes_at)} 마감 · 링크에서 바로 참여할 수 있어요.`;
  return {
    title,
    description,
    alternates: { canonical: `/posts/${code}` },
    openGraph: { title, description, url: `/posts/${code}`, type: 'article' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function Page({ params }: Props) {
  const { code } = await params;
  return <PostDetail code={code} />;
}
