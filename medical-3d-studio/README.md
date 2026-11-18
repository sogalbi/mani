# Medical 3D Shorts Studio

한국어 일반 시청자용 **교육용 3D 의학 쇼츠**(세로 9:16, 30~60초)를 만드는 제작 파이프라인입니다.
설계 문서: [`docs/design_v1.0.md`](docs/design_v1.0.md)

> 자동화는 **조사·초안·렌더까지**. 게시는 의료 전문가와 정책 담당자의 승인 기록이 모두 맞아야만 "게시 가능"이 나옵니다.
> 승인 뒤에 대본·근거·영상이 한 글자라도 바뀌면 그 승인은 자동으로 무효(STALE)가 됩니다. `UNKNOWN`은 통과가 아닙니다.

## 지금 상태 (MVP 1편: 관상동맥 스텐트 원리)

| 단계 | 상태 |
|---|---|
| 주제 패키지 `T0001` (범위·주장 8개·대본 43초·장면 7개) | 초안 완료 |
| 3D 장면 (혈관 단면·플라크·풍선·스텐트·가이드와이어·혈구) | 코드로 자동 조립 완료 |
| 540×960 프리뷰 렌더 + 자막 | 완료: 영상 파일은 공개 저장소에 올리지 않고, 해시는 `renders/preview/T0001_v001.manifest.json`에 기록 |
| AI 내레이션 | 완료(v002): Supertonic 3 목소리 F1. 화면은 v001 그대로, 소리만 추가. 해시는 `T0001_v002.manifest.json` |
| AI 사전 검증 | **보류**: 출처 13개·정책 14개를 원문으로 확인하지 못함 (작업 환경 네트워크 차단) |
| 의료 전문가 검수 (G1, G3) | 검수자 미정 |
| 게시 | 불가 (위 단계 미완료) |

`python -m studio status` 로 언제든 확인할 수 있어요.

## 빠른 시작

```bash
cd medical-3d-studio
pip install -r requirements.txt
python -m studio status T0001        # 게이트 G0~G5 상태와 다음 할 일
python -m studio check T0001         # AI 사전 검증 (BLOCK / WARN / INFO)
python -m studio narrate T0001       # AI 내레이션 트랙 (pip install supertonic 필요)
python -m pytest -q                  # 규칙 테스트
```

3D 렌더에는 Blender가 필요합니다. 둘 중 하나:

```bash
export M3D_BLENDER=/Applications/Blender.app/Contents/MacOS/Blender   # Blender 4.4 이상
# 또는
python3.13 -m venv ~/bpy && ~/bpy/bin/pip install bpy==5.2.3 && export M3D_BPY_PYTHON=~/bpy/bin/python
python -m studio render T0001        # 프리뷰 540×960 (CPU로 약 1시간 반, 중간에 멈춰도 이어서 렌더)
```

같은 장면이면 프레임을 다시 렌더하지 않고 자막만 새로 입혀요(몇 초).

이 컴퓨터에 프레임이 없을 때 소리만 바꾸려면 `render T0001 --reuse-video`: 장면(shots.json)과 자막이 이전 렌더와 같으면
그 화면을 다시 인코딩하지 않고 그대로 쓰고 소리만 바꿔요. 매니페스트에는 화면을 만든 당시의 스펙·코드 해시와
`video_stream_from`이 남아요.

## 제작 흐름

```
Topic Scout ─▶ G0 주제 승인 (편집자)
Evidence Researcher ─▶ Medical Fact Checker ─▶ Script Editor ─▶ G1 근거 승인 (의료 전문가)
3D Director ─▶ Asset & License Manager ─▶ G2 자산 승인 (권리 담당)
Blender Builder (studio render) ─▶ G3 프리뷰 승인 (의료 전문가: 3D 움직임·단면·자막·음성)
studio render --final (1080×1920) ─▶ Policy & Legal QA ─▶ G4 게시 승인 (정책·법률)
Publishing QA (studio publish-check) ─▶ 사람이 수동 업로드 ─▶ studio published
Analytics & Correction (studio correction) ─▶ G5 게시 후 감시: 중대 오류면 HOLD + 재검수
```

- **에이전트 7개**는 Claude Code 하위 에이전트로 들어 있어요: 저장소 루트의 `.claude/agents/m3d-*.md`.
  Claude Code에서 "m3d-evidence-researcher로 T0002 근거 찾아줘"처럼 부르면 됩니다.
- **Blender Builder · Publishing QA · Analytics & Correction**은 판단보다 규칙이라 CLI 명령으로 만들었어요.

## 명령

| 명령 | 하는 일 |
|---|---|
| `status [주제]` | G0~G5 상태, 무효가 된 이유, 다음 할 일 |
| `check 주제 [--all]` | 근거 확인 여부, 근거 없는 대본 줄, 과장·단정·치료 유인 표현, "플라크 제거" 같은 오해 표현, 수행 세부값(기압·mm), 자막 길이·읽기 속도, 대본↔장면↔자막 일치, 자산 권리, 게시 문구, 정책 근거 재확인 |
| `narrate 주제 [--samples]` | 대본 줄마다 AI 음성을 만들어 그 줄의 자막 시간 안에 맞춘 43초 트랙(-16 LUFS). 칸보다 긴 줄만 `max_speed`까지 빨리 읽고, 넘치면 `check`가 경고. `--samples`는 목소리 10개 비교용 |
| `render 주제 [--final] [--reuse-video]` | 장면 조립 → Cycles 렌더 → H.264 MP4(자막 있음/없음) + ASS/SRT + 소리(내레이션 또는 무음) + 매니페스트(해시) |
| `packet 주제 [--gate G1] [--embed]` | 전문가가 폰으로 보는 검수 페이지. 체크리스트를 누르면 운영자에게 보낼 판정 기록이 만들어져요. `--embed`는 영상을 넣은 파일 하나 |
| `approve 주제 게이트 --reviewer ID --decision PASS --checked all` | 승인 기록. 역할·전문과목·체크리스트·자동 점검 BLOCK·앞 단계 통과를 모두 확인 |
| `publish-check 주제` | 게시 가능/보류 판정, 설명란 생성(출처 목록 포함) |
| `published 주제 --url URL` | 업로드 후 영상 기록 |
| `correction open 주제 --severity critical --report "..."` | 정정 티켓. critical/major면 G1·G3 재검수 전까지 보류 |
| `dashboard` | `index.html` 현황판 |
| `new-topic T0002 slug --subject "..."` | 새 주제 뼈대 |
| `validate` | 모든 데이터 파일을 `schemas/`로 검사 |

## 폴더

```
config/        channel.yaml(형식·렌더 품질) style.yaml(색·자막) policy.yaml(게이트·체크리스트·점검 규칙) reviewers.yaml(검수자 명부)
research/      sources.yaml(문헌, 모든 주제 공용) policy_refs.yaml(유튜브 정책·국내 법령 참고처)
topics/T0001_coronary_stent/   topic.yaml claims.yaml script.yaml shots.json
assets/        registry.yaml(권리표) camera_presets/ motion_presets/ materials/ fonts/(Pretendard, OFL)
blender/scripts/  build_scene.py + m3d/(해부·병리·기구·혈구·라벨·카메라·모션 프리셋 코드)
renders/       preview/ final/ — 매니페스트(.manifest.json)에 영상·대본·장면·코드 해시
reviews/       medical/ legal_policy/ — 승인 기록(추가만), packets/(생성물)
publishing/    게시 문구, videos.yaml, out/(설명란)
analytics/     corrections.yaml(정정 티켓)
schemas/       데이터 스키마 (topics, sources, claims, assets, shots, approvals, videos, corrections …)
```

## 3D 장면이 지키는 것

- 모든 모델을 코드로 직접 만들어 외부 모델 라이선스 문제가 없어요. 스텐트는 특정 제품이 아닌 일반형이에요.
- 플라크는 풍선·스텐트에 **눌려 얇아질 뿐 사라지지 않아요** (설계 문서 7장). 혈관 벽은 플라크가 다 눌린 뒤에만 조금 늘어나요.
- 혈구·벽 두께는 실제 비율이 아니에요. 화면 위쪽에 "교육용 3D 개념도 · 실제 크기·혈류와 다름"이 계속 떠 있어요.
- 수술 장면 같은 피·조직 손상 표현은 쓰지 않아요.

## 사람이 해야 할 일

1. **출처 원문 확인**: `research/sources.yaml`의 13개 주소를 열어 문장을 확인하고 `verification: VERIFIED`, `checked_at`, `claims.yaml`의 `quote`를 채우기 (또는 네트워크가 열린 환경에서 m3d-evidence-researcher 다시 실행).
2. **정책 원문 확인**: `research/policy_refs.yaml` 14개 (유튜브 고객센터, 국가법령정보센터, 한국저작권위원회 등). 게시 직전 30일 안에 다시.
3. **검수자 등록**: `config/reviewers.yaml`에 순환기내과(심장내과) 등 전문의와 편집자·권리·정책 담당을 넣고 `active: true`.
4. **게시 문구**: `publishing/T0001_coronary_stent.yaml`의 정정 연락처, 검수 표기, 합성 콘텐츠 공개 여부(YES/NO).
5. **내레이션 음성**: AI 음성(Supertonic 3)으로 v002를 만들었어요. 권리 담당이 `assets/registry.yaml`의 `voice_supertonic3`(OpenRAIL-M 조건)를 G2에서 확인하고,
   전문가가 G3에서 발음·속도를 들어 보세요. 빠르게 읽는 줄(L01 x1.21, L08 x1.30)은 `check`에 WARN으로 나와요. 목소리를 바꾸려면 `narrate --samples`로 들어 보고 `script.yaml`의 `voice.voice_name`을 바꾼 뒤 `narrate` → `render`.
6. 설계 문서 12장의 결정 사항: 전문가 계약 범위·보수·책임, 의료광고/협찬 수용 여부와 법률 자문, 렌더 비용과 월간 제작량, 정책 점검 주기.

## 알아 둘 점

- 저장소가 **공개**라서 검수 전 영상(`renders/preview/*.mp4`)과 검수 패킷은 커밋하지 않아요. 영상의 SHA-256은 매니페스트에 남아 승인 기록과 연결됩니다.
- 내레이션 음성 모델(Supertonic 3, OpenRAIL-M)은 상업 이용이 되지만 조건이 있어요: AI가 만든 음성임을 밝혀야 하고(설명란 'AI 음성' 표기, 빠지면 `check`가 BLOCK),
  의료 조언 용도로는 쓸 수 없어요(개인 진단·치료 권고가 아닌 일반 교육인지 G2·G4에서 확인). 음성은 영상과 같이 공개 저장소에 올리지 않아요(`build/narration/`, `renders/*/*_narration.wav`).
- 해시는 운영체제와 상관없이 같아요: 코드 해시는 `/` 경로와 LF 줄바꿈으로 계산하고, 자막 파일은 LF로 써요(Windows의 git autocrlf 체크아웃에서도 클라우드와 같은 값).
- 승인 기록은 YAML에 남는 내부 기록이에요(전자서명이 아님). 검수자가 직접 커밋하거나 메시지로 받은 판정을 보관하세요.
- 의료 전문가 검수는 의료광고 심의 면제나 법적 안전을 보장하지 않아요. 협찬·특정 병원 언급·환자 자료가 생기면 G4는 법률 전문가만 승인할 수 있어요.
- 렌더는 CPU 기준 프레임당 약 4~6초(540×960, 16샘플). 최종 1080×1920은 약 4배 걸려요.
- 렌더가 끝나면 프레임별 밝기를 자동으로 비교해, 장면 중간에 갑자기 바뀐 프레임(깨진 프레임)을 매니페스트 `qa`에 표시해요. 첫 렌더에서 Blender의 프레임 간 캐시(persistent data) 버그로 S06 일부가 깨졌던 것을 이 점검으로 찾았고, 지금은 그 캐시를 끄고 렌더해요.
