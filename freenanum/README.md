# 프리나눔 (FREENANUM)

2026 겨울 e-프리퀀시 **무료 나눔·스티커 교환** 웹서비스. 기준 문서: 「프리나눔 통합 기획·개발 명세 v3.0」.

- 일반 모바일 웹에서 모든 기능을 쓸 수 있어요. 2.5D 광장(`/world`)은 선택 진입이에요.
- 실제 스티커 선물은 이용자가 **스타벅스 공식 앱에서 직접** 해요. 프리나눔은 신청·추첨·매칭·이력·신고를 이어 주는 곳이고, 공식 앱의 전송을 확인하지 않아요.
- 프리나눔은 스타벅스가 운영하거나 보증하는 서비스가 아니에요.

## 구성

| 부분 | 기술 | 위치 |
|---|---|---|
| 화면 | Next.js 16 (App Router) + TypeScript, 모바일 1열 | `app/`, `components/`, `lib/` |
| 서버 로직 | Supabase Postgres 함수(RPC) — 추첨·거래 상태·바코드·신고·등급 | `supabase/migrations/` |
| 로그인 | Supabase Auth 이메일 6자리 코드 (카카오는 선택) | `app/login`, `supabase/templates/` |
| 정기 작업 | pg_cron 5분마다 `run_scheduled_jobs()` (기한 처리·자동 추첨) | `…_security.sql` 끝 |
| 테스트 | 명세 §19 QA 기준 31개 (DB 직접 호출) | `tests/qa.test.mjs` |

### 보안 구조 (명세 §9·§15)

- 클라이언트는 **어떤 테이블에도 직접 쓰지 못하고**, 시즌·설정 테이블만 읽을 수 있어요. 모든 동작은 권한·상태를 검사하는 서버 함수로만 해요(`security definer`, `search_path=''`).
- 바코드 번호는 `private` 스키마(API 비노출)에 **pgcrypto로 암호화**해 저장하고, 키는 **Supabase Vault**에만 있어요(마이그레이션이 무작위 키를 자동 생성).
- 원문은 `reveal_barcode`로 **그 거래의 보내는 사람에게만**, 전송 단계에서만, 최대 5회 보여 줘요. 열람 시도(거절 포함)는 모두 기록하고, 번호 자체는 어떤 로그에도 남기지 않아요. 전송 신고·종료·분쟁이 되면 암호문도 지워요. 운영자 화면에도 원문은 없어요.
- 추첨은 서버의 CSPRNG 시드로 **한 번만** 실행돼요(추첨 행 unique + 행 잠금). 퀴즈 정답·가위바위보 상대 패는 모집 전에 확정해 **sha256 해시를 공개**하고, 마감 뒤 원문을 공개해 누구나 맞춰 볼 수 있어요.
- 거래 기록(`trade_events`), 추첨 기록, 동의 기록, 성장 점수 기록, 운영자 감사로그는 **추가만 가능**(수정·삭제 시 오류).
- 한쪽이라도 "보냈어요"를 신고한 거래는 기한이 지나도 **자동 완료·취소하지 않고 분쟁**으로 넘겨요. 아무도 보내지 않은 거래만 기한 만료로 정리해요.
- 성장 점수는 **수령 확인된 무료 나눔**에만, 거래당 1번(unique 키) 줘요. 교환은 따로 셉니다.

## 로컬에서 실행

필요한 것: Node 20+, Docker, [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
cd freenanum
npm install
npx supabase start            # DB·인증·API·메일함(Mailpit) 실행, 마이그레이션 자동 적용
cp .env.example .env.local    # supabase start가 출력한 API URL / anon key 입력
node scripts/seed-demo.mjs    # (선택) 데모 회원·게시글
npm run dev                   # http://127.0.0.1:3000
```

- 로그인 코드는 Mailpit(http://127.0.0.1:54324)에서 확인해요. 데모 회원: `giver@demo.local`(별빛나눔), `latte@demo.local`(라떼한잔), `bear@demo.local`(겨울곰), `sos@demo.local`(미션한장), `admin@demo.local`(운영자).
- DB 테스트: `npm run test:db` (로컬 Supabase가 켜져 있어야 해요).
- 화면 점검(Playwright, 스크린샷 저장): `node scripts/e2e.mjs` (dev 서버 + 데모 데이터 필요).

## 배포 (Supabase + Vercel)

1. **Supabase 프로젝트** 만들기 → 로컬에서 `npx supabase link --project-ref <ref>` → `npx supabase db push` (마이그레이션 5개 적용, Vault 키·pg_cron 작업 자동 생성).
   - pg_cron이 꺼져 있으면 Dashboard → Database → Extensions에서 켠 뒤 `select cron.schedule('freenanum-jobs','*/5 * * * *','select public.run_scheduled_jobs()');` 실행.
2. **Auth 설정** (Dashboard → Authentication)
   - URL Configuration: Site URL = 서비스 주소, Redirect URLs에 `https://<도메인>/**`.
   - Email Templates → *Magic Link*와 *Confirm signup* 본문을 `supabase/templates/magic_link.html` 내용으로 바꾸기(6자리 `{{ .Token }}` 포함).
   - 실제 메일 발송용 SMTP 연결(기본 메일은 시간당 발송 수가 아주 적어요).
   - (선택) Kakao 제공자를 켜고 `NEXT_PUBLIC_ENABLE_KAKAO=1`.
3. **Vercel**에 이 저장소를 연결하고 Root Directory를 `freenanum`으로 지정 → 환경변수 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` 입력 → 배포.
4. **첫 운영자 지정**: 운영자 계정으로 한 번 가입한 뒤 SQL Editor에서
   `update public.profiles set role = 'admin' where nickname = '운영자닉네임';`
5. 시즌 값 확인: `/admin` → 설정 탭에서 시즌 기간·완성 기준·기한 시간 조정.

## 구현 상태 (명세 §2 기준)

| 범위 | 내용 | 상태 |
|---|---|---|
| P0 | 모바일 홈·게시판·상세·등록·신청, 로그인/닉네임/필수 동의, 권한, 운영자 화면 | 완료 |
| P0 | 나눔·교환 거래 단계, 영수증형 이력(타임라인, 추가 전용) | 완료 |
| P0 | 바코드 거래별 제한 공개·암호화·열람 기록, 신고·차단·미이행·분쟁 처리 | 완료 |
| P0 | 시즌·스티커 종류 설정, 만료 처리(pg_cron) | 완료 |
| P1 | 랜덤 / 퀴즈 / 가위바위보 4판 / 직접 선정, 예비 당첨자 승계, 공정성 기록 | 완료 |
| P1 | 스레드 공유 링크·공유 카드(OG 이미지), 선택형 스레드 계정 소유 확인(수동) | 완료 |
| P1 | 나눔 장수 기반 6단계 등급·캐릭터 장식 | 완료 |
| P1 | 일반/미션 규칙 기반 매칭 화면 | 부분 — 보유/필요 수량은 이 기기에만 저장, **자동 매칭 알림 없음** |
| P1 | 감사 우체통 | 미구현 |
| P2 | 2.5D 단일 나눔 광장(정적 SVG + 핫스팟, 대안 A) | 완료(최소 장면) |
| P3 | 여러 건물·실시간 접속·채팅·GLB 1,033개 편집기 | 이번 시즌 제외(명세대로) |

## 출시 전에 꼭 확인할 것

- **공식 정책**: 스타벅스 e-프리퀀시 선물 규칙·제3자 중개 관련 약관, 실제 시즌 일정(10/22~12/31)과 완성 기준. 불확실하면 무료 나눔만 먼저 열고 교환은 제한 베타로.
- **법률 검토**: `/help`의 이용약관·개인정보 처리 안내는 **초안**이에요. 보관 기간, 삭제 요청 절차, 문의 경로, 바코드(개인정보 여부) 처리 근거를 확정해야 해요.
- **알림 발송**: 지금은 앱 안 알림만 있어요. 카카오 알림톡·이메일·웹 푸시는 미구현.
- **남은 보안 위험**: 한 번 열람한 바코드를 상대가 따로 적어 두는 것은 막을 수 없어요. 다중 계정·허위 거래 탐지는 신고·운영자 판단에 의존해요(자동 탐지 없음). 신규 계정 교환 동시 진행 수 제한(기본 3)만 있어요.
- **추첨 실행 주체**: 마감된 나눔은 5분 주기 작업이 자동 추첨하고, 그 전에 로그인한 누구나 "결과 보기"로 실행을 앞당길 수 있어요(결과는 서버 시드로 정해지고 1회만 실행). 운영 정책상 스케줄러 전용으로 바꾸려면 `draw_giveaway` 실행 권한을 회수하면 돼요.
- **GLB 데이터셋**: Google Scanned Objects GLB(CC BY 4.0)는 이번 시즌 광장에 쓰지 않았어요(실사 스캔과 동화풍의 이질감·성능). 쓴다면 소품 5~15개만 골라 최적화하고 `/help#credits`에 출처·변경 표기.
