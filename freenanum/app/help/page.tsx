import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '도움말·안내',
  description: '프리나눔 이용 방법, 안전 고지, 신고 안내, 이용약관·개인정보 처리 안내(초안).',
};

const OFFICIAL = 'https://www.starbucks.co.kr/whats_new/campaign_view.do?pro_seq=3499';

const TOC = [
  ['about', '프리나눔은 어떤 곳인가요'],
  ['start', '시작하기(가입 없음)'],
  ['how', '이용 방법'],
  ['safety', '꼭 알아 두세요(안전 고지)'],
  ['report', '신고와 이의신청'],
  ['season', '2026 겨울 시즌'],
  ['terms', '이용약관(초안)'],
  ['privacy', '개인정보 처리 안내(초안)'],
  ['contact', '문의'],
  ['credits', '출처 표기'],
] as const;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card stack" style={{ scrollMarginTop: 72 }} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {children}
    </section>
  );
}

function Draft() {
  return <span className="badge terra">초안 · 출시 전 법률 검토 필요</span>;
}

export default function HelpPage() {
  return (
    <div className="stack">
      <h1>도움말·안내</h1>

      <nav className="card soft" aria-label="목차">
        <ol className="stack-sm small" style={{ margin: 0, paddingLeft: 20 }}>
          {TOC.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`}>{label}</a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="about" title="프리나눔은 어떤 곳인가요">
        <p>남는 e-프리퀀시 스티커를 무료로 나누고, 필요한 종류끼리 교환하도록 이어 주는 시즌 한정 공간이에요.</p>
        <p className="notice">
          프리나눔은 스타벅스가 직접 운영하거나 보증하는 공식 서비스가 아닌 독립적인 스티커 나눔·교환 연결 공간입니다. 실제
          e-스티커 선물은 이용자가 스타벅스 공식 앱에서 직접 진행합니다.
        </p>
        <p className="small muted">
          프리나눔은 신청·매칭·기록·신고를 돕는 곳이에요. 스티커를 보관하거나 대신 보내지 않고, 공식 앱의 전송 내역을 확인할 수도
          없어요.
        </p>
      </Section>

      <Section id="start" title="시작하기(가입 없음)">
        <ul className="stack-sm small" style={{ margin: 0, paddingLeft: 20 }}>
          <li>회원가입이 없어요. 글 보기는 누구나 바로 할 수 있어요.</li>
          <li>처음 신청하거나 글을 쓸 때 닉네임만 정하면 이 기기에서 바로 시작돼요.</li>
          <li>
            내 기록은 이 기기(브라우저)에 묶여 있어요. 브라우저 데이터를 지우거나 다른 기기로 바꾸면 기록을 다시 찾지 못할 수 있어요.
          </li>
          <li>
            예전에 이메일을 연결해 두었다면 <Link href="/login">내 기록 불러오기</Link>에서 다른 기기의 기록을 불러올 수 있어요(선택).
          </li>
        </ul>
      </Section>

      <Section id="how" title="이용 방법">
        <h3>무료 나눔</h3>
        <ol className="stack-sm small" style={{ margin: 0, paddingLeft: 20 }}>
          <li>나눔자가 종류·장수·선정 방식·마감 시각을 정해 글을 올려요.</li>
          <li>받고 싶은 사람은 규칙을 확인하고 신청해요(게임형은 퀴즈·가위바위보까지).</li>
          <li>마감 뒤 서버가 당첨자와 예비 순서를 정해요. 결과는 글에서 볼 수 있어요.</li>
          <li>당첨자는 기한 안에 수령 의사를 확인해요.</li>
          <li>각자 거래 화면에 스레드 아이디를 입력해요. 받는 사람은 바코드 번호도 입력해요.</li>
          <li>서로 상대의 스레드 아이디를 확인해요. 양쪽이 확인하면 보내는 사람에게 바코드가 보여요. 확인한 상대의 닉네임·스레드 아이디는 MY › 거래 상대에 자동 저장돼요.</li>
          <li>나눔자는 공식 앱에서 선물한 뒤 &ldquo;보냈어요&rdquo;를 눌러요.</li>
          <li>받는 사람이 공식 앱에서 확인하고 &ldquo;받았어요&rdquo;를 누르면 완료예요.</li>
        </ol>
        <h3>교환</h3>
        <ol className="stack-sm small" style={{ margin: 0, paddingLeft: 20 }}>
          <li>교환 글의 조건을 보고 제안해요. 게시자가 수락하면 조건이 그대로 기록돼요.</li>
          <li>양쪽이 각자 스레드 아이디와 바코드를 입력하고, 서로 상대 스레드 아이디를 확인해요.</li>
          <li>확인되면 상대 바코드가 보여요. 공식 앱에서 직접 보내요.</li>
          <li>각자 &ldquo;보냈어요&rdquo;와 &ldquo;받았어요&rdquo;를 모두 눌러야 완료예요.</li>
        </ol>
        <h3>선정 방식 4가지</h3>
        <dl className="kv">
          <dt>랜덤 추첨</dt>
          <dd>마감 뒤 서버가 신청자 중에서 무작위로 뽑아요.</dd>
          <dt>퀴즈</dt>
          <dd>정답자 중에서 무작위로 뽑아요. 정답은 마감 전까지 비공개예요.</dd>
          <dt>가위바위보 4판</dt>
          <dd>상대 패 4개는 서버가 미리 정해 해시로 공개하고, 마감 뒤 원문을 공개해요. 가장 많이 이긴 사람들 중에서 뽑아요.</dd>
          <dt>직접 선정</dt>
          <dd>나눔자가 신청자 중에서 골라요. 무작위 추첨이 아니에요.</dd>
        </dl>
        <p className="small">
          <b>예비 당첨자:</b> 당첨자가 기한 안에 응답하지 않거나 포기하면 예비 순서대로 기회가 넘어가요. 처음 추첨 기록은 바뀌지
          않아요.
        </p>
        <p className="small">
          <b>기본 기한:</b> 수령 의사·바코드 입력 24시간 · 전송 신고 12시간 · 수령 확인 48시간. 운영 상황에 따라 운영자가 바꿀
          수 있어요.
        </p>
      </Section>

      <Section id="safety" title="꼭 알아 두세요(안전 고지)">
        <h3>교환 승인 시</h3>
        <p className="notice warn small">
          전송한 e-스티커는 회수하기 어려우며, 상대방이 약속한 스티커를 보내지 않거나 응답하지 않을 위험이 있습니다. 거래 조건을
          확인하고 신중하게 진행해 주세요. 프리나눔의 기록·신고 기능이 스티커의 회수나 반환을 보장하지는 않습니다.
        </p>
        <h3>바코드 제공 시</h3>
        <p className="notice warn small">
          바코드 번호는 해당 나눔·교환 거래에서 스티커를 보내는 상대에게 제한적으로 제공됩니다. 상대가 한번 열람한 정보는 회수할
          수 없으니 신중하게 제공해 주세요.
        </p>
        <h3>이벤트 참가 시</h3>
        <p className="notice small">
          나눔 참여가 당첨을 보장하지는 않습니다. 선정 방식, 마감 시각, 당첨·예비 규칙과 수령 기한을 확인해 주세요.
        </p>
        <ul className="stack-sm small" style={{ margin: 0, paddingLeft: 20 }}>
          <li>&ldquo;보냈어요&rdquo;(전송 신고)는 이용자 본인의 신고예요. 프리나눔이 공식 앱 전송을 확인한 것이 아니에요.</li>
          <li>
            한쪽이 전송 신고를 한 뒤 상대가 응답하지 않으면 자동으로 취소되거나 완료되지 않고, 운영자 확인(분쟁)으로 넘어가요.
          </li>
          <li>현금 거래, 판매, 유료 추첨·유료 재도전, 당첨 확률 구매는 모두 금지예요.</li>
          <li>바코드는 게시글·댓글·스레드에 올리지 마세요. 거래 화면의 전용 입력칸에만 넣어 주세요.</li>
          <li>상대 스레드 아이디가 평소 알던 계정과 다르면 바코드를 열기 전에 멈추고 신고해 주세요.</li>
        </ul>
      </Section>

      <Section id="report" title="신고와 이의신청">
        <ul className="stack-sm small" style={{ margin: 0, paddingLeft: 20 }}>
          <li>거래 화면의 &ldquo;문제 신고&rdquo; 또는 게시글·사용자 메뉴의 신고로 접수해요.</li>
          <li>접수하면 접수번호가 나와요. 처리 상태는 <Link href="/me/reports">MY › 내 신고</Link>에서 볼 수 있어요.</li>
          <li>진행 중인 거래를 신고하면 거래가 분쟁 상태로 바뀌고, 운영자가 기록과 증빙을 확인해요.</li>
          <li>공식 앱의 전송·수령 내역 화면을 증빙으로 요청할 수 있어요. 이미지만으로 위조 여부를 확정하지는 못해요.</li>
          <li>
            제재나 처리 결과에 이의가 있으면 접수번호와 함께 <a href="#contact">문의 경로</a>로 알려 주세요. 다시 검토해요.
          </li>
        </ul>
      </Section>

      <Section id="season" title="2026 겨울 시즌">
        <dl className="kv">
          <dt>기간</dt>
          <dd>2026년 10월 22일 ~ 12월 31일</dd>
          <dt>기본 기준</dt>
          <dd>미션 스티커 3개 포함 총 17개</dd>
        </dl>
        <p className="small">
          공식 안내:{' '}
          <a href={OFFICIAL} target="_blank" rel="noreferrer">
            스타벅스 코리아 이벤트 페이지
          </a>
        </p>
        <p className="faint">출시 시점·선물 규칙·약관은 운영 시작 전에 공식 안내로 다시 확인해요. 시즌이 끝나면 새 나눔·교환은 멈춰요.</p>
      </Section>

      <Section id="terms" title="이용약관">
        <Draft />
        <ol className="stack-sm small" style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <b>서비스 성격</b> — 프리나눔은 e-프리퀀시 스티커의 무료 나눔·교환 신청과 기록을 돕는 독립 서비스예요. 스타벅스와
            관계가 없고, 스티커를 보관·전송하지 않아요.
          </li>
          <li>
            <b>금지 행위</b> — 현금·대가 거래, 유료 추첨, 허위 거래, 다중 계정, 바코드 무단 사용·공개, 욕설·도배·광고는 금지예요.
          </li>
          <li>
            <b>거래 책임과 한계</b> — 실제 선물은 이용자가 공식 앱에서 직접 해요. 프리나눔은 상대의 이행을 보장하지 못하고,
            보낸 스티커를 되돌릴 수 없어요. 문제가 생기면 기록과 신고로 대응을 도와요.
          </li>
          <li>
            <b>기록 보존</b> — 게시글을 지워도 거래 단계·확인 기록은 분쟁 대응을 위해 정해진 기간 동안 따로 보관해요. 기록은
            이용자의 기기 세션에 묶여 있어, 브라우저 데이터를 지우면 이용자가 다시 찾지 못할 수 있어요.
          </li>
          <li>
            <b>제재와 이의신청</b> — 신고와 증빙을 검토한 뒤 경고·이용 제한·정지를 할 수 있고, 이의신청 기회를 드려요.
          </li>
          <li>
            <b>시즌 종료</b> — 시즌이 끝나면 새 참여를 멈추고, 진행 중인 거래와 신고를 정리한 뒤 서비스를 닫거나 기록 열람만
            남겨요.
          </li>
        </ol>
      </Section>

      <Section id="privacy" title="개인정보 처리 안내">
        <Draft />
        <dl className="kv">
          <dt>수집 항목</dt>
          <dd>
            닉네임 · 거래별 스레드 아이디(그 거래의 상대와 운영자만 볼 수 있어요) · 바코드 번호(거래 중에만) · 거래·신고·동의
            기록 · 기기 세션 식별자(가입 없이 이 기기를 구분하는 값) · 선택: 직접 연결한 경우에만 이메일
          </dd>
          <dt>거래 상대 목록</dt>
          <dd>
            거래에서 상대 스레드 아이디를 확인하면, 그 상대의 닉네임·스레드 아이디·최근 거래가 내 계정에 저장돼요. 나만 볼 수 있고
            언제든 지울 수 있어요. 바코드 번호는 저장하지 않아요.
          </dd>
          <dt>바코드 번호</dt>
          <dd>
            당첨·교환이 성사된 거래에서만 받아요. 암호화해 저장하고, 서로 스레드 아이디를 확인한 뒤 그 거래에서 보내는 사람에게만
            정해진 횟수 안에서 보여요.
            전송 신고·거래 종료 시 원문을 지워요. 운영자도 원문을 볼 수 없어요.
          </dd>
          <dt>이용 목적</dt>
          <dd>기기 구분, 나눔·교환 진행과 상대 확인, 이력 제공, 신고·분쟁 대응, 부정 이용 방지</dd>
          <dt>보관 기간</dt>
          <dd>시즌 종료 후 ○개월 — 확정 필요(관련 법령상 보존 의무가 있으면 그 기간)</dd>
          <dt>삭제 요청</dt>
          <dd>문의 경로로 요청하면 확인 후 삭제·익명화해요. 분쟁 대응에 필요한 최소 기록은 보존 기간 동안 남을 수 있어요.</dd>
          <dt>문의</dt>
          <dd>
            <a href="#contact">문의 경로</a> (확정 필요)
          </dd>
        </dl>
      </Section>

      <Section id="contact" title="문의">
        <p className="small">운영 계정 DM 또는 이메일 — 출시 전 확정</p>
        <p className="faint">신고·이의신청은 접수번호를 함께 알려 주시면 빨라요.</p>
      </Section>

      <Section id="credits" title="출처 표기">
        <p className="small">현재 외부 3D 에셋 없음. 나눔 광장은 직접 그린 SVG로 만들었어요.</p>
        <p className="faint">
          나중에 Google Scanned Objects 모델을 쓰면 이렇게 표기해요: &ldquo;[모델 이름] — Google Research, Google Scanned
          Objects, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), 변경: 크기 조정·압축&rdquo;. 실제 상품의 브랜드·로고
          권리는 별도로 확인해요.
        </p>
      </Section>
    </div>
  );
}
