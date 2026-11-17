/*
 * 배포 설정 (이 파일만 고치면 돼요)
 * ws: 'auto'  → 이 페이지를 연 서버의 /ws 에 연결 (Render·Docker 등 node server.js 로 띄운 경우)
 * ws: false   → 서버 없이 혼자 모드 (GitHub Pages 같은 정적 호스팅에서 미리 보기)
 * ws: 'wss://내서버주소/ws' → 다른 곳에 띄운 서버에 연결 (그 서버의 ALLOWED_ORIGINS 에 이 페이지 주소를 넣어 주세요)
 */
window.PETSPACE_CONFIG = { ws: 'auto' };
