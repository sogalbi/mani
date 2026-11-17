# mani

K.ASRAI 사진용 폰 웹앱 두 개(`index.html` 워터마크 컷, `mark/` 마크 찍기)와 인스타 운영 작업 폴더가 있는 레포. GitHub Pages로 `https://sogalbi.github.io/mani/` 에 그대로 배포된다. 사용자와는 한국어로 대화한다.

## 인스타 작업

- 작업 파일은 전부 `.claude/instagram/` 에 둔다: `voice.md`(말투), `swipe.md`(잘된 릴스 모음), `plan.md`(주간 계획), `log.md`(올린 기록).
- 인스타 스킬(`/ig-*`)이 `~/.claude/instagram/…` 를 읽거나 쓰라고 하면 이 레포의 `.claude/instagram/…` 로 바꿔 읽고 쓴다. 클라우드 세션은 홈 폴더가 남지 않는다.
- 스킬 안내는 `.claude/instagram/README.md`. 스킬이 아직 설치되어 있지 않으면 거기 적힌 설치 명령을 사용자에게 보여 주고, 스킬 없이도 되는 부분(캡션 초안, 대본 초안)은 그대로 진행한다.
- 인스타에 직접 올리거나 댓글·DM을 보내는 자동화는 하지 않는다. 결과물은 복사해서 붙여넣을 글로 끝낸다.
- 사용자가 주지 않은 숫자(팔로워 수, 매출, 조회수)는 지어내지 않고 `{{your number}}` 자리로 남긴다.
- 이 레포는 Pages로 공개되므로 `.claude/instagram/` 에 비공개 숫자·고객 이름을 적지 않는다.

## 웹앱

- `index.html`, `mark/index.html` 은 각각 파일 하나로 동작하는 정적 앱이다. 빌드 없음, 서버 없음.
- 수정 뒤에는 Playwright로 열어 동작을 확인한다.
