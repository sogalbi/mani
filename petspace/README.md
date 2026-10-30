# 멍냥사 (가칭) — 반려동물과 말없이 같이 앉아 있는 온라인 절

온라인 절 [산사](https://sansatemple.com/)의 "말없이 같이 앉아 있는" 형식을 반려동물에 맞게 다시 만든 웹 서비스예요.
조사 내용과 사업 계획은 [`docs/sansatemple_analysis.md`](../docs/sansatemple_analysis.md)에 계속 업데이트해요.

- 가입·설치 없이 링크 하나로 들어와요. 우리 아이 이름, 종류(강아지·고양이·토끼·햄스터·새), 털 색, "곁에 있어요 / 무지개다리를 건넜어요"를 고르면 그 아이 모습으로 마루 방석에 앉아요.
- 같은 마루(방)에 있는 사람들의 아이가 실시간으로 보여요. 대화는 없어요.
- 할 수 있는 것: 절하기(오늘 횟수 표시, 108배), 합장, 간식 올리기(마루별로 쌓임), 연등 달기, 염주·목탁(나만 보고 나만 들음), 내 아이를 누르면 꼬리 흔들기, 빈 방석 눌러 옮겨 앉기.
- 연등: 무지개다리를 건넌 아이는 하얀 연등(영가등), 곁에 있는 아이는 색 연등. 문구는 정해진 것 중에 골라요(욕설·광고를 원천 차단). 24시간 뒤 내려가고, 3명이 신고하면 바로 내려가요.
- 마루는 24자리씩이고 차면 다음 마루가 자동으로 열려요. 링크(`?room=maru-3`)로 같은 마루에 친구를 부를 수 있고, "우리끼리 마루"는 링크를 받은 사람만 들어와요.
- 소리(풍경, 빗소리, 풀벌레, 싱잉볼, 목탁)는 녹음 파일 없이 기기에서 만들고, 나한테만 들려요.
- 서버에 연결되지 않으면(예: GitHub Pages) "혼자 모드"로 동작해요. 가짜 접속자는 만들지 않아요.

## 바로 띄우기 (Render, 휴대폰으로 가능)

1. 이 PR을 기본 브랜치에 합치기(merge).
2. [render.com](https://render.com)에 GitHub로 로그인 → **New → Blueprint** → `sogalbi/mani` 고르기.
3. 저장소 맨 위의 `render.yaml`을 읽어서 `meongnyangsa` 서비스를 보여줘요 → **Apply**.
4. 2~3분 뒤 `https://meongnyangsa.onrender.com` 같은 주소가 생겨요. 그 주소가 바로 서비스예요.
5. 관리자 토큰은 Render → 서비스 → Environment 의 `ADMIN_TOKEN` 에서 볼 수 있어요.

- 무료(free) 플랜은 15분 동안 손님이 없으면 잠들고, 다음 손님이 오면 깨어나는 데 1분쯤 걸려요. 디스크도 다시 켜질 때 비워져서 연등이 사라질 수 있어요. 홍보를 시작하는 날에는 `render.yaml`의 `plan: free`를 `starter`로 바꾸거나 Render 화면에서 플랜을 올려 주세요.
- 내 도메인을 쓰려면 Render → Settings → Custom Domains 에 추가하면 돼요.

## 다른 곳에 띄우기

```bash
# 내 컴퓨터
cd petspace
npm install
npm start            # http://localhost:8080

# Docker (Fly.io, Railway, 일반 서버 어디든)
docker build -t meongnyangsa petspace
docker run -p 8080:8080 -v meongnyangsa-data:/data -e TRUST_PROXY=1 -e ADMIN_TOKEN=비밀값 meongnyangsa
```

정적 호스팅(GitHub Pages 등)에 `public/` 폴더만 올리면 혼자 모드로 열려요. 다른 곳에 띄운 서버와 연결하려면 `public/config.js`의 `ws`에 `wss://서버주소/ws`를 적고, 서버의 `ALLOWED_ORIGINS`에 페이지 주소를 넣어 주세요.

## 설정 (환경 변수)

| 이름 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `8080` | 서버 포트 |
| `ROOM_CAPACITY` | `24` | 마루 하나의 방석 수 (4~100). 화면 배치가 자동으로 맞춰져요 |
| `MAX_ROOMS` | `500` | 동시에 열 수 있는 마루 수 |
| `MAX_CONN_PER_IP` | `60` | IP 하나당 동시 연결 수. 회사·통신사는 IP를 나눠 쓰니 너무 낮추지 마세요 |
| `REPORTS_TO_HIDE` | `3` | 연등이 내려가는 신고 수 |
| `TRUST_PROXY` | Render·Fly에선 자동 | 프록시 뒤라면 `1` (실제 접속 IP를 읽어요) |
| `ALLOWED_ORIGINS` | 비어 있음 | 다른 주소의 페이지에서 접속을 허락할 때 쉼표로 나열 |
| `DATA_DIR` | `./data` | 연등과 하루 통계를 저장하는 곳 (1분마다, 끌 때 저장) |
| `ADMIN_TOKEN` | 비어 있음 | 비어 있으면 관리자 API가 꺼져요 |

## 숫자 보기와 관리

```bash
# 지금 접속자, 마루 목록, 오늘 연등·간식·절 수 (누구나)
curl https://주소/api/stats

# 날짜별 방문·최고 동시 접속·연등·간식·절 (관리자)
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://주소/api/admin/stats

# 연등 내리기: /api/lanterns 에서 id 를 찾은 뒤
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"id":"연등id"}' https://주소/api/admin/hide
```

## 구조

```
petspace/
  server.js        정적 파일 + WebSocket(/ws) + API
  lib/hub.js       마루·방석·연등·통계 로직 (네트워크와 분리)
  public/
    index.html     화면 뼈대와 시트
    style.css
    app.js         캔버스 장면, 연결, 행동, 소리, 염주
    shared.js      서버와 브라우저가 같이 쓰는 값·이름 검사·문구 목록
    config.js      연결할 서버 주소
  test/            npm test
```

- 서버는 이동(걷기)을 주고받지 않고 "앉기·절·연등" 같은 사건만 보내요. 산사가 첫날 서버가 터진 걸 참고해서, 사람이 많아져도 주고받는 양이 아주 적게 설계했어요.
- 이름 검사(`shared.js`의 `BLOCKED`)에 막을 말을 더 넣을 수 있어요. 연등 문구는 `WISHES`에서 고쳐요.
- 테스트: `npm test`
