# aiweb2026-hub

AI웹융합 학생 프로젝트 전시관 — 27명의 학생 페이지(`s01.aiweb2026.site` ~ `s27.aiweb2026.site`)의 라이브 상태와 메타데이터(title/description)를 한 화면에 모아 보여주는 갤러리.

- 운영 URL: https://aiweb2026.site
- 인프라: Cloudflare Workers + Static Assets (Worker 1개에 정적 자산 + `/api/meta` 라우터 통합)
- 메타 추출: 학생 페이지의 진짜 origin을 Google Sheet 매핑에서 조회 후 fetch (same-zone 제약 우회)

## 빠른 시작

```bash
npm install
npm run dev      # http://localhost:8788
npm run deploy   # wrangler deploy (CLOUDFLARE_API_TOKEN 필요)
```

## 학생 추가

1. 학생 본인이 자기 Worker/Pages 띄우고 URL 확보
2. 시트에 `이름, sNN.aiweb2026.site, https://학생origin, IP` 행 추가
3. `public/index.html`의 `STUDENTS` 배열에 항목 추가 후 commit/push

## 문서

- [docs/cloudflare-architecture.md](docs/cloudflare-architecture.md) — Workers/Pages 차이, zone 토폴로지, same-zone subrequest 사건과 해결책, 운영 가이드
