# Cloudflare 아키텍처 노트

이 프로젝트의 인프라 선택, 마이그레이션 이력, 트러블슈팅을 정리한 문서.

---

## 1. Workers vs Pages — 정리 (2026 기준)

### 통합 전 (~2024)

| 항목 | Workers | Pages |
|---|---|---|
| 주 용도 | 동적 코드 (API, 라우팅, 미들웨어) | 정적 사이트 (SPA, SSG) |
| 정적 자산 | KV에 직접 push (불편) | Git 연동 자동 빌드, CDN 캐싱 |
| 함수 | 단일 fetch handler | `functions/` 디렉토리 (`onRequestGet` 등 자동 라우팅) |
| 배포 | `wrangler deploy` (`wrangler.toml`) | `wrangler pages deploy` 또는 git 자동 |
| 로컬 dev | `wrangler dev` | `wrangler pages dev` |
| 도메인 | Custom Domain or Routes | Custom Domain (자동 cert) |

→ 기능이 겹치고, 어떤 워크로드를 어디에 둘지 헷갈리는 게 큰 단점이었음.

### 통합 후 (2024년 9월~, 2026 현재)

Cloudflare가 **Workers + Static Assets** 모델을 도입하여 Pages의 정적 자산 처리 능력을 Workers에 흡수. 신규 프로젝트는 Workers로 시작하기를 권장.

| 항목 | 통합 Workers (현재 권장) |
|---|---|
| 정적 자산 | `wrangler.toml`의 `[assets]` 섹션, `directory` + `binding` 지정 |
| 동적 코드 | `main` entry의 fetch handler에서 라우팅, 정적은 `env.ASSETS.fetch(request)` 위임 |
| 함수 디렉토리 컨벤션 | 더 이상 `functions/` 자동 라우팅 안 함 (Pages 전용 컨벤션) |
| 배포 | `wrangler deploy` 단일 명령 |
| 로컬 | `wrangler dev` |
| Git 연동 빌드 | `npx wrangler deploy`를 자동 실행 — `wrangler.toml` 필수 |

**Pages는 deprecated되지 않았지만**, 신규는 통합 Workers, 기존 Pages는 그대로 유지·운영.

### 이 프로젝트 선택

처음엔 Pages Functions 컨벤션(`functions/api/meta.js`)으로 시작했으나, 빌드 환경이 통합 Workers 기준으로 동작(`npx wrangler deploy` 자동 실행)해서 다음과 같이 마이그레이션함:

```
이전 (Pages Functions)              현재 (Workers + Static Assets)
─────────────────────              ────────────────────────────
index.html                    →    public/index.html
functions/api/meta.js         →    src/meta.js (handleMeta 함수로 리팩터)
                              +    src/index.js  (Worker 라우터)
                              +    wrangler.toml (main + [assets])
```

---

## 2. 현재 zone 토폴로지

```
zone: aiweb2026.site
├── aiweb2026.site            → Worker: aiweb2026-hub  (Custom Domain)
├── *.aiweb2026.site/*        → Worker: aiweb-proxy    (Routes)
│                                └─ Google Sheet에서 슬롯→진짜 origin URL 조회 후 reverse proxy
├── example.aiweb2026.site/*  → Worker: example-aiweb2026  (Routes, demo)
└── test.aiweb2026.site       → Worker: test-size       (Custom Domain)
```

**Workers**:
- `aiweb2026-hub` — 본 프로젝트(갤러리 + `/api/meta`)
- `aiweb-proxy` — 학생 서브도메인 reverse proxy
- `example-aiweb2026`, `test-size` — 보조

**학생 페이지의 진짜 호스팅 위치**:
시트(`1pDMyc5J...`)의 `Page Link` 컬럼에 학생 각자의 외부 URL이 있음. 예:
- `s01` → `https://s01-aiweb2026.dlsrbtla.workers.dev`
- `s05` → `https://s05-aiweb2026.aline2385102.workers.dev`
- `s10` → `https://lmkaiweb20263782.moonk3yu.workers.dev`

학생들이 자기 계정에 별도 Worker를 띄우고, 그 URL을 시트에 등록하면 `aiweb-proxy`가 자동으로 `s01.aiweb2026.site` 같은 정돈된 서브도메인으로 노출시켜 줌.

---

## 3. 사건: 522 Connection Timed Out — same-zone subrequest

### 증상

- 로컬(`wrangler dev`): `/api/meta`가 학생 페이지 메타를 정상 추출
- production(`https://aiweb2026.site/api/meta`): 모든 학생 페이지에 대해 `{"ok":false,"status":522,"title":null}`
- 학생 페이지 직접 호출(`curl https://s01.aiweb2026.site`): 200 정상

### 원인

Cloudflare Workers는 **같은 zone 내의 다른 Worker로 일반 fetch를 보내는 것을 차단**합니다 (subrequest loop 방지). Service Binding을 명시적으로 설정해야 cross-Worker 호출이 가능합니다.

이 프로젝트의 경우:

```
Hub Worker (aiweb2026-hub) 
   │
   └─ fetch("https://s01.aiweb2026.site")
        ↓
     Cloudflare zone routing
        ↓
     "*.aiweb2026.site/*" 매칭 → aiweb-proxy Worker
        ↓
     ❌ 같은 zone의 다른 Worker는 직접 fetch 불가 → 522
```

로컬에서는 wrangler dev가 우리 Mac에서 직접 외부로 fetch하므로 zone 경계가 의미 없어 정상 동작했음.

### 우회 시도와 결과

| 시도 | 결과 |
|---|---|
| `cf: { cacheTtl, cacheEverything }` 옵션 제거 | ❌ 여전히 522 |
| User-Agent를 일반 브라우저로 위장 | ❌ 여전히 522 |
| timeout 8s → 12s 확장 | ❌ 여전히 522 |
| Service Binding (학생별 27개) | ❌ 비현실적 |

이런 시도들이 다 실패한 이유: 차단은 application 레이어가 아니라 Cloudflare 네트워크 레이어에서 일어나기 때문.

### 해결책 (채택)

**진짜 origin URL을 Hub Worker가 직접 fetch**.

`aiweb-proxy`가 시트에서 매핑을 조회하듯, Hub도 같은 시트를 직접 조회해서 학생의 외부 origin(`*.workers.dev` 등)을 얻은 뒤 그것으로 fetch. 외부 origin은 다른 zone이라 same-zone 제약이 없음.

핵심 코드:

```js
// src/meta.js
if (parsed.hostname.endsWith(`.${SHEET_ROOT_DOMAIN}`)) {
  const subdomain = parsed.hostname.slice(0, -(SHEET_ROOT_DOMAIN.length + 1));
  const mapping = await getMapping(ctx);          // 시트 조회 + 5분 캐싱
  const realOrigin = mapping[subdomain];          // s01 → https://s01-...workers.dev
  if (!realOrigin) return jsonResponse({ ok: false, error: 'slot not registered' });
  fetchUrl = realOrigin;                          // ← 실제 fetch 대상 교체
}

const upstream = await fetch(fetchUrl, { ... });  // 다른 zone이라 통과
```

### 검증

```bash
$ curl 'https://aiweb2026.site/api/meta?url=https://s01.aiweb2026.site'
{"ok":true,"status":200,"title":"🚀 demo — by <rigu1>",
 "description":"...","origin":"https://s01-aiweb2026.dlsrbtla.workers.dev"}
```

---

## 4. 다른 해결책들 (검토 후 미채택)

| 옵션 | 장점 | 단점 |
|---|---|---|
| **Hub를 다른 zone으로** (예: `hub.다른도메인.com`) | 가장 확실한 우회 | 도메인 구입/추가, 갤러리 URL 변경 |
| **학생 페이지에 CORS 헤더 추가 → 클라이언트에서 직접 fetch** | Hub 코드 단순화 | 학생 27명 협조 필요, 유지보수 부담 |
| **Service Binding 학생 27개 추가** | Cloudflare 공식 권장 | 학생별로 Hub `wrangler.toml`에 binding 명시 + 학생 Worker 변경 시마다 동기화 |
| **외부 프록시(Vercel 등) 경유** | zone 무관 | 추가 인프라 |
| **Cloudflare Browser Rendering API** | 동적 페이지(JS 렌더) 메타까지 추출 | 유료/베타, 오버킬 |
| **시트에서 진짜 origin 조회 (채택)** | 추가 인프라 0, 학생 협조 0 | 시트 ID가 코드에 노출(이미 aiweb-proxy에도 있음) |

---

## 5. 향후 주의사항

### 같은 zone에 Worker가 2개 이상일 때

- Worker A에서 Worker B의 호스트로 fetch는 **항상 막힌다**고 생각하고 설계
- 호출이 필요하면 처음부터 **Service Binding**으로 명시적 연결
- 또는 두 Worker가 공유하는 **데이터 소스(KV / D1 / 시트)** 를 통해 우회

### 로컬과 production 동작 차이를 의심해야 할 신호

- `wrangler dev`에서는 잘 동작하는데 production에서만 실패
- 특히 fetch 결과가 522/523/524 → Cloudflare 네트워크 레이어 이슈일 가능성 높음
- production 진단은 **`wrangler tail`** 로 실시간 로그 보기 (`npx wrangler tail aiweb2026-hub`)

### 새 학생 추가 시

1. 학생이 자기 Worker 띄우고 URL 확보
2. 시트(`1pDMyc5J...`)의 다음 행에 `이름, sNN.aiweb2026.site, https://학생-worker-url.workers.dev, IP` 추가
3. `aiweb-proxy` 캐시 만료(최대 5분) 후 자동 라우팅 시작
4. Hub의 `STUDENTS` 배열(`public/index.html`)에도 항목 추가 후 git push

### Hub 갤러리에 표시되는 카드 정보 출처

```
카드 표시 항목                         출처
─────────────────                     ────
슬롯 코드 (s01)                       URL에서 추출 (정적, 항상 표시)
도메인 (s01.aiweb2026.site)           URL (정적)
title (페이지 제목)                    학생 페이지의 <title>  ← /api/meta가 origin 직접 fetch
description                          학생 페이지의 <meta name="description"> 또는 og:description
status (Live/Offline)                 fetch 결과 ok 여부
```

---

## 6. 운영 명령어

```bash
# 로컬 개발
npm run dev                                    # wrangler dev --port 8788

# 배포 (수동)
npm run deploy                                 # wrangler deploy
# Git push로 Cloudflare 자동 배포도 가능 (wrangler.toml 인식)

# production 로그 (디버깅 시)
set -a && . ./.env && set +a
npx wrangler tail aiweb2026-hub --format pretty

# Worker Routes 확인
curl -s "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/workers/routes" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq

# Worker 스크립트 다운로드 (다른 Worker 코드 보고 싶을 때)
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/<NAME>" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

---

## 7. 참고

- Cloudflare Workers — Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Workers vs Pages 가이드: https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/
- Service Bindings: https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- Worker subrequest 제약: https://developers.cloudflare.com/workers/platform/limits/#subrequests
