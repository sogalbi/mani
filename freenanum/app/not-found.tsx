import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card stack center" style={{ alignItems: 'center', padding: '32px 16px' }}>
      <span aria-hidden style={{ fontSize: '2.4rem' }}>🍂</span>
      <h1>길을 잃었어요</h1>
      <p className="muted">찾는 페이지가 없거나 지워졌어요. 링크를 다시 확인해 주세요.</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link className="btn" href="/">
          홈으로
        </Link>
        <Link className="btn secondary" href="/posts">
          게시판 보기
        </Link>
      </div>
    </div>
  );
}
