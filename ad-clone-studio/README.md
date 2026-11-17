# AD CLONE STUDIO

Windows용 광고 레퍼런스 분석·재현 스튜디오. 이 저장소 폴더에는 설계서의 **M0(실행 가능한 껍데기) ~ M1(분석 MVP)** 이 구현되어 있습니다.

참고 광고 영상(MP4/MOV)을 가져오면 메타데이터를 읽고, 컷(쇼트)을 자동으로 나누고, 쇼트마다 시작/중간/끝 썸네일을 만들어 타임라인으로 보여 줍니다. 쇼트 경계는 직접 고칠 수 있고, 모든 내용은 프로젝트 폴더에 저장되어 다시 열 수 있습니다.

> 영상 생성 AI, 의미 분석(VLM), 렌더링은 아직 없습니다(M2 이후). 원본 영상은 읽기만 하며 수정하지 않습니다.

## 지금 되는 것

| 기능 | 내용 |
|---|---|
| 프로젝트 | 새로 만들기 / 열기 / 최근 10개. 편집 즉시 자동 저장, 폴더를 옮겨도 열림 |
| 영상 가져오기 | MP4/MOV. 확장자가 아니라 ffprobe로 실제 스트림을 확인. 프로젝트에 복사 또는 원본 위치 참조 선택. SHA-256 기록 |
| 메타데이터 | 길이, 해상도(회전 반영), fps(avg/r, VFR 의심 표시), 코덱, 오디오, 비트레이트 |
| 쇼트 자동 감지 | PySceneDetect `AdaptiveDetector`. 감도·최소 길이 조절. 짧은 쇼트는 경고만 하고 자동으로 합치지 않음 |
| 썸네일·타임라인 | 쇼트별 시작/중간/끝 JPG, 쇼트 블록 타임라인, 썸네일 목록 |
| 플레이어 | 재생/일시정지, 1프레임 이동, 쇼트를 누르면 그 위치부터 재생 |
| 경계 편집 | 분할(S), 병합(M), 타임라인에서 경계 드래그, 숫자 입력, 자동 감지 결과로 되돌리기 |
| 오류·취소 | 작업은 워커 스레드에서 실행. 진행률·취소 버튼. 실패해도 기존 프로젝트 데이터 유지. 작업 도중 종료되면 다음에 열 때 "중단됨"으로 표시하고 빠진 썸네일을 다시 생성 |

## Windows 설치

필요한 것: Windows 11, **Python 3.11**, **FFmpeg**(ffmpeg.exe + ffprobe.exe).

```powershell
winget install Python.Python.3.11
winget install Gyan.FFmpeg        # 설치 후 터미널을 새로 열어야 PATH에 잡힙니다

cd ad-clone-studio
powershell -ExecutionPolicy Bypass -File scripts\setup_windows.ps1
```

스크립트는 `.venv`를 만들고 `requirements.lock`의 고정 버전을 설치합니다. 직접 하려면:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.lock
.\.venv\Scripts\python -m pip install --no-deps -e .
```

FFmpeg를 PATH에 넣지 않았다면 앱의 **도구 > 환경 진단**에서 폴더를 지정하거나 환경변수 `ADCLONE_FFMPEG_DIR`을 설정하세요.

## 실행

```powershell
scripts\run_dev.ps1
# 또는
.\.venv\Scripts\python -m adclone
```

1. 홈 화면에서 프로젝트 이름을 넣고 **프로젝트 만들기**
2. **영상 가져오기…** 로 MP4/MOV 선택 → 메타데이터 확인, 쇼트 감지, 썸네일 생성이 이어서 실행됩니다
3. 쇼트를 눌러 재생해 보고, 경계가 틀린 곳은 타임라인에서 끌거나 **분할/병합**으로 고칩니다
4. 닫았다가 홈 화면의 **최근 프로젝트**에서 다시 엽니다

테스트용 영상이 없으면 직접 만들 수 있습니다(상업 광고는 저장소에 넣지 않습니다):

```powershell
.\.venv\Scripts\python -m adclone.devtools.make_sample sample.mp4 --profile ad15
```

프로필: `hardcuts`(가로 12초), `portrait`(세로 29.97fps), `ad15`(15초), `single`(컷 없음), `rotated`(회전 메타데이터 MOV — 출력 파일 이름을 `.mov`로).

GUI 없이 같은 분석을 실행하는 CLI도 있습니다.

```powershell
.\.venv\Scripts\python -m adclone.cli doctor
.\.venv\Scripts\python -m adclone.cli analyze sample.mp4 --project .\my_project
.\.venv\Scripts\python -m adclone.cli show .\my_project --json
```

## 테스트

```powershell
scripts\run_tests.ps1
# 또는
.\.venv\Scripts\python -m pytest -q
```

테스트 영상은 실행할 때 FFmpeg로 합성합니다. GUI 테스트는 창을 띄우지 않고(`QT_QPA_PLATFORM=offscreen`) 실제 메인 윈도우를 구동합니다.

| 파일 | 검증 내용 |
|---|---|
| `test_timebase.py` | ms↔프레임 변환, 29.97fps, 쇼트별 프레임 합 = 전체 프레임 |
| `test_shot_ops.py` | 분할/병합/경계 이동과 잘못된 편집 거부 |
| `test_probe.py` | 메타데이터 추출, 회전·VFR·오디오 없음, 영상이 아닌 파일/빈 파일/없는 파일/오디오만 있는 파일 |
| `test_scene_detector.py` | 합성 하드컷 4종에서 컷 위치 일치(±0.2초 기준 precision/recall ≥ 0.85), 진행률, 취소 |
| `test_thumbnails.py` | 키프레임 3장, 컷 양쪽 프레임이 서로 다른 장면인지, 회전 영상, 파일 끝 |
| `test_project_roundtrip.py` | 저장→재열기 100% 복원, 폴더 이동, 중단 표시, 손상된 DB, 원자적 저장 |
| `test_pipeline_e2e.py` | 실제 영상으로 가져오기→감지→썸네일→재열기, 실패/취소 시 데이터 유지 |
| `test_ui_smoke.py` | 메인 윈도우에서 생성→가져오기→분석→편집→재열기, 타임라인 드래그, 취소 후 재시도 |

## 검증 범위와 한계

이 코드는 **Linux 컨테이너(Python 3.11.18, FFmpeg 6.1.1, PySide6 6.12.0, PySceneDetect 0.7.3, OpenCV 5.0.0)** 에서 작성하고 테스트했습니다. Windows에서는 아직 한 번도 실행하지 않았습니다.

Linux에서 확인한 것:

- 전체 테스트 스위트 통과(결과는 PR 설명 참고)
- 합성 영상 4종을 CLI로 분석해 컷 위치가 생성 시 지정한 값과 일치
- 메인 윈도우를 offscreen으로 구동해 전체 흐름 동작, 화면 캡처로 레이아웃 확인
- 플레이어가 실제로 프레임을 디코딩하고 탐색·1프레임 이동이 동작

**Windows에서 직접 확인이 필요한 것:**

- 앱 창이 뜨고 영상이 화면에 보이는지, 소리가 나는지 (offscreen에서는 영상 영역이 그려지지 않아 눈으로 확인하지 못했습니다)
- 파일 선택 창, 메시지 창 등 실제 대화상자 (테스트에서는 자동 응답으로 대체)
- `requirements.lock` 설치. Linux에서 고정한 버전이며 Windows 전용 의존성 `colorama`는 버전을 고정하지 못했습니다
- 한글이 들어간 경로의 영상을 OpenCV(쇼트 감지)가 여는지. Linux에서는 한글 경로로 테스트했지만 Windows의 경로 처리는 다릅니다. 문제가 있으면 "프로젝트에 복사"를 선택하고 프로젝트를 영문 경로에 두세요
- 가져온 영상을 다른 영상으로 교체할 때 파일 잠금 (교체 전에 플레이어를 닫도록 구현했지만 Windows에서만 생기는 문제라 확인하지 못했습니다)
- PowerShell 스크립트 3개 (작성만 했고 실행해 보지 못했습니다)

알려진 한계:

- 쇼트 감지는 하드컷 위주입니다. 디졸브·플래시·빠른 움직임은 놓치거나 잘못 나눌 수 있어 수동 편집이 필요합니다. 실제 광고 골든셋으로 정확도를 측정하지 않았습니다(합성 영상만 사용)
- 플레이어의 화면 표시는 컷 경계에서 1프레임 정도 어긋날 수 있습니다. 썸네일(FFmpeg 추출)이 기준입니다
- 5~60초를 벗어난 영상은 경고만 하고 분석은 진행합니다
- 편집 실행 취소(Ctrl+Z)는 없습니다. "자동 감지 결과로 되돌리기"만 있습니다
- 한 번에 한 프로젝트만 열 수 있고, 같은 프로젝트를 두 창에서 여는 경우는 막지 않습니다
- 편집용 프록시 영상, 오디오 추출, 색상/움직임 분석, 배포 패키징(PyInstaller)은 다음 단계입니다

## 프로젝트 폴더

```text
<프로젝트>/
  project.db            # 기준 데이터 (SQLite)
  project.json          # 사람이 읽는 요약 (DB에서 다시 만들어짐)
  reference/original.mp4
  shots/shot_s001/
    keyframe_start.jpg  keyframe_middle.jpg  keyframe_end.jpg
    analysis.json       # 구간(ms), 출력 프레임 범위, 수동 편집 여부
  assets/  exports/     # M2 이후 사용
  logs/jobs.log         # 작업 기록
```

시간은 원본 기준 밀리초로 저장합니다. 프레임 번호는 프로젝트 fps로 환산한 표시값이며, 쇼트별 프레임 수의 합이 전체 프레임 수와 같도록 누적 경계를 반올림합니다. 자동 감지 결과는 수동 편집과 별도로 보관되어 언제든 되돌릴 수 있습니다.

앱 설정과 로그는 `%APPDATA%\ADCloneStudio\`(settings.json, logs\app.log)에 있습니다.

## 코드 구조

```text
src/adclone/
  app.py, __main__.py     GUI 진입점
  cli.py                  GUI 없는 분석 실행
  config.py               앱 설정, 최근 프로젝트, 로그
  domain/                 모델, 타임베이스, 쇼트 편집(순수 함수), 오류, 이벤트
  project/                SQLite 저장소, 스키마, 폴더 레이아웃, 서비스
  ingest/                 FFmpeg 탐지/실행, ffprobe, 원본 복사·해시, 썸네일
  analysis/               쇼트 감지, 워커용 파이프라인
  jobs/                   취소 토큰, 백그라운드 작업 실행기
  ui/                     홈, 분석 화면, 플레이어/타임라인/쇼트 목록 위젯
  devtools/make_sample.py 테스트 영상 합성
tests/                    위 표 참고
scripts/                  Windows 설치/실행/테스트 스크립트
```

설계서의 `src/adclone` 구조를 따르되 M0~M1에 필요한 모듈만 만들었습니다. `generators/`, `render/`, `safety/`는 해당 마일스톤에서 추가합니다.
