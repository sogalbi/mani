# 꼬리별 추모관 (가칭) — 반려동물 온라인 추모관

떠난 아이 사진을 큰 화면에 띄우고, 다른 보호자들과 말없이 같이 기억하는 실시간 웹 서비스예요.
온라인 절 [산사](https://sansatemple.com/)의 "가입 없이 들어와 같이 있는" 형식을 참고해, 한국식 추모관(빈소)으로 만들었어요.
조사 내용과 사업 계획은 [`docs/sansatemple_analysis.md`](../docs/sansatemple_analysis.md)에 계속 업데이트해요.

- **들어오기**: 아이 사진을 고르고 이름, 화면에 띄울 한마디("초코야, 보고 싶어" 같은 문구를 고르거나 직접 쓰기), 함께한 해를 적어요. 추모관에서 걸어 다닐 캐릭터(강아지·고양이·토끼·햄스터·새, 털 색 6가지)도 골라요. 사진 없이 조문만 할 수도 있어요.
- **큰 화면**: 국화 제단 가운데 화면에서 새로 들어온 아이를 먼저 소개하고, 그다음 추모실 아이들을 차례로 보여 줘요. 모두 같은 화면을 봐요.
- **걸어 다니기**: 바닥을 누르면 내 캐릭터가 그쪽으로 걸어가요. 같은 추모실 사람들의 캐릭터도 실시간으로 움직여요.
- **국화**: 헌화대로 걸어가서 지금 화면에 있는 아이에게 국화를 올리고 묵념해요. 헌화대에 국화가 쌓여요.
- **묵념·한마디**: 고개를 숙이거나, 정해진 말("보고 싶어", "힘내세요" 등)을 머리 위 말풍선과 큰 화면에 잠깐 띄워요. 자유 채팅은 없어요.
- **우리 아이**: 내 아이를 화면에 다시 띄워요(1분에 한 번). 사진이 없으면 "사진 올리기"로 바뀌어요.
- **기억의 벽**: 최근 7일 동안 올라온 아이들 사진 모음. 넓은 화면에서는 벽에 액자로도 걸려요.
- **추모실**: 30명씩, 차면 다음 호실이 열려요. `?room=hall-3` 링크로 같은 방에 부를 수 있고, "가족 추모실"은 링크를 받은 사람만 들어와요.
- **안전**: 사진은 기기에서 줄이고 위치 정보(EXIF)를 지운 뒤 올라가요. 신고가 3번 쌓이면 사진이 바로 내려가고 주소도 막혀요. 7일 뒤 자동 정리.
- **소리**: 오르골, 빗소리, 헌화 종소리를 기기에서 만들어요(녹음 파일 없음). 나한테만 들려요.
- 서버에 연결되지 않으면(예: GitHub Pages) 혼자 모드로 동작해요. 가짜 접속자는 만들지 않아요.

## 바로 띄우기 (Render, 휴대폰으로 가능)

1. 이 PR을 기본 브랜치에 합치기(merge).
2. [render.com](https://render.com)에 GitHub로 로그인 → **New → Blueprint** → `sogalbi/mani` 고르기.
3. 저장소 맨 위의 `render.yaml`을 읽어서 `kkoribyeol` 서비스를 보여줘요 → **Apply**.
4. 2~3분 뒤 `https://kkoribyeol.onrender.com` 같은 주소가 생겨요. 그 주소가 바로 서비스예요.
5. 관리자 토큰은 Render → 서비스 → Environment 의 `ADMIN_TOKEN` 에서 볼 수 있어요.

**꼭 알아 둘 것 — 사진 보관**: 무료(free) 플랜은 15분 동안 손님이 없으면 잠들고, 다시 켜질 때 디스크가 비워져서 **올린 사진이 사라져요**. 테스트는 무료로 해도 되지만, 홍보를 시작하기 전에는 유료 플랜(starter 이상)으로 올리고 `render.yaml`에 주석으로 넣어 둔 디스크(`disk`)와 `DATA_DIR=/data`를 켜 주세요.

내 도메인을 쓰려면 Render → Settings → Custom Domains 에 추가하면 돼요.

## 다른 곳에 띄우기

```bash
# 내 컴퓨터
cd petspace
npm install
npm start            # http://localhost:8080

# Docker (Fly.io, Railway, 일반 서버 어디든) — /data 를 볼륨으로 붙이면 사진이 남아요
docker build -t kkoribyeol petspace
docker run -p 8080:8080 -v kkoribyeol-data:/data -e TRUST_PROXY=1 -e ADMIN_TOKEN=비밀값 kkoribyeol
```

정적 호스팅(GitHub Pages 등)에 `public/` 폴더만 올리면 혼자 모드로 열려요. 다른 곳에 띄운 서버와 연결하려면 `public/config.js`의 `ws`에 `wss://서버주소/ws`를 적고, 서버의 `ALLOWED_ORIGINS`에 페이지 주소를 넣어 주세요.

## 설정 (환경 변수)

| 이름 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `8080` | 서버 포트 |
| `ROOM_CAPACITY` | `30` | 추모실 하나에 들어올 수 있는 수 |
| `MAX_ROOMS` | `500` | 동시에 열 수 있는 추모실 수 |
| `TRIBUTE_TTL_DAYS` | `7` | 사진·추모 카드를 보관하는 날 수 |
| `PHOTO_UPLOADS_PER_10MIN` | `12` | IP 하나가 10분 동안 올릴 수 있는 사진 수 |
| `MAX_CONN_PER_IP` | `60` | IP 하나당 동시 연결 수. 회사·통신사는 IP를 나눠 쓰니 너무 낮추지 마세요 |
| `REPORTS_TO_HIDE` | `3` | 사진이 내려가는 신고 수 |
| `TRUST_PROXY` | Render·Fly에선 자동 | 프록시 뒤라면 `1` (실제 접속 IP를 읽어요) |
| `ALLOWED_ORIGINS` | 비어 있음 | 다른 주소의 페이지에서 접속을 허락할 때 쉼표로 나열 |
| `DATA_DIR` | `./data` | `state.json`(추모 카드·하루 통계)과 `photos/`(사진)를 저장하는 곳 |
| `ADMIN_TOKEN` | 비어 있음 | 비어 있으면 관리자 API가 꺼져요 |

## 숫자 보기와 관리

```bash
# 지금 접속자, 추모실 목록, 오늘 방문·사진·국화·한마디 수 (누구나)
curl https://주소/api/stats

# 최근 올라온 아이들 (누구나, 기억의 벽과 같은 내용)
curl https://주소/api/tributes

# 날짜별 방문·최고 동시 접속·사진·국화·한마디·묵념 (관리자)
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://주소/api/admin/stats

# 사진 내리기: /api/tributes 에서 id 를 찾은 뒤
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"id":"추모카드id"}' https://주소/api/admin/hide
```

## 구조

```
petspace/
  server.js        정적 파일 + 사진 올리기(/api/photos) + 사진 주소(/photos/…) + WebSocket(/ws) + API
  lib/hub.js       추모실·위치·추모 카드·헌화·통계 로직 (네트워크와 분리)
  public/
    index.html     화면 뼈대와 시트
    style.css
    app.js         캔버스 추모관, 캐릭터 걷기, 큰 화면, 사진 준비, 연결, 소리
    shared.js      서버와 브라우저가 같이 쓰는 값·이름·한마디 검사·문구 목록
    config.js      연결할 서버 주소
  test/            npm test
```

- 걷기는 "어디로 가는지"만 누를 때 한 번 보내고, 움직임은 각 기기가 그려요. 사람이 많아져도 주고받는 양이 적어요.
- 큰 화면은 서버 시각 기준으로 모두 같은 순서로 넘어가요(`shared.js`의 `slideMs`, `spotMs`).
- 막을 말은 `shared.js`의 `BLOCKED`, 화면 한마디 문구는 `MESSAGES`, 홀 말풍선은 `WORDS` 에서 고쳐요.
- 테스트: `npm test`
