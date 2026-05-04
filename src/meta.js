/**
 * 학생 페이지 메타데이터 추출 프록시 — Worker 핸들러
 *
 * 사용:
 *   GET /api/meta?url=https://s01.aiweb2026.site
 *
 * 반환:
 *   { ok: true, status: 200, title: "심인규의 포트폴리오", description: "..." }
 *   { ok: false, error: "fetch failed" }
 */

const ALLOWED = /(^|\.)aiweb2026\.site$|\.pages\.dev$|\.workers\.dev$/i;

export async function handleMeta(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    });
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }

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

    // og:description > twitter:description > meta[name=description] 순서로 시도
    const description = extractMeta(html, [
      /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:description["']/i,
      /<meta[^>]+name=["']twitter:description["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']description["']/i,
    ]);

    return jsonResponse(
      { ok: upstream.ok, status: upstream.status, title, description },
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

function extractMeta(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const cleaned = match[1].replace(/\s+/g, ' ').trim();
      if (cleaned) return decodeEntities(cleaned);
    }
  }
  return null;
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
