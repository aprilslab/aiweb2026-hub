/**
 * Cloudflare Pages Function — 학생 페이지 메타데이터 추출 프록시
 *
 * 자동 라우팅: 이 파일은 배포 시 /api/meta 엔드포인트로 자동 매핑됩니다.
 *
 * 사용:
 *   GET /api/meta?url=https://s01.aiweb2026.site
 *
 * 반환:
 *   { ok: true, status: 200, title: "심인규의 포트폴리오" }
 *   { ok: false, error: "fetch failed" }
 *
 * 배포: index.html과 함께 git에 push하면 Cloudflare Pages가 알아서 배포합니다.
 */

export async function onRequestGet({ request }) {
  const target = new URL(request.url).searchParams.get('url');

  if (!target) {
    return jsonResponse({ error: 'missing url' }, 400);
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return jsonResponse({ error: 'invalid url' }, 400);
  }

  // 화이트리스트 — 임의의 외부 사이트 프록시 방지
  const ALLOWED = /(^|\.)aiweb2026\.site$|\.pages\.dev$|\.workers\.dev$/i;
  if (!ALLOWED.test(parsed.hostname)) {
    return jsonResponse({ error: 'host not allowed' }, 403);
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      cf: { cacheTtl: 120, cacheEverything: true },
      headers: { 'User-Agent': 'aiweb2026-hub/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });

    const html = await upstream.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const rawTitle = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : null;
    const title = rawTitle ? decodeEntities(rawTitle) : null;

    return jsonResponse(
      { ok: upstream.ok, status: upstream.status, title },
      200,
      { 'Cache-Control': 'public, max-age=120' }
    );
  } catch (err) {
    const reason = err.name === 'TimeoutError' || err.name === 'AbortError'
      ? 'timeout'
      : 'fetch failed';
    return jsonResponse(
      { ok: false, error: reason },
      200,
      { 'Cache-Control': 'public, max-age=30' }
    );
  }
}

// CORS preflight — 같은 origin이라 필수는 아니지만 안전하게 처리
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  });
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
