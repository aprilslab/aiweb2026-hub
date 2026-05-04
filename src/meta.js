/**
 * 학생 페이지 메타데이터 추출 프록시 — Worker 핸들러
 *
 * 사용:
 *   GET /api/meta?url=https://s01.aiweb2026.site
 *
 * 반환:
 *   { ok: true, status: 200, title: "심인규의 포트폴리오", description: "...", origin: "..." }
 *   { ok: false, error: "fetch failed" }
 *
 * 같은 zone(*.aiweb2026.site) 학생 페이지로 직접 fetch하면 cross-Worker
 * subrequest 차단(522)에 걸리므로, 시트 매핑에서 진짜 외부 origin URL을
 * 찾아 그걸 fetch한다.
 */

import { getMapping, SHEET_ROOT_DOMAIN } from "./sheet.js";

const ALLOWED_FALLBACK = /\.pages\.dev$|\.workers\.dev$/i;

export async function handleMeta(request, ctx) {
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
  if (!target) return jsonResponse({ error: 'missing url' }, 400);

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return jsonResponse({ error: 'invalid url' }, 400);
  }

  // 학생 페이지(*.aiweb2026.site)는 시트에서 진짜 origin으로 치환
  let fetchUrl = parsed.toString();
  let resolvedOrigin = null;

  if (parsed.hostname.endsWith(`.${SHEET_ROOT_DOMAIN}`)) {
    const subdomain = parsed.hostname
      .slice(0, -(SHEET_ROOT_DOMAIN.length + 1))
      .toLowerCase();

    try {
      const mapping = await getMapping(ctx);
      const realOrigin = mapping[subdomain];
      if (!realOrigin) {
        return jsonResponse(
          { ok: false, error: 'slot not registered', slot: subdomain },
          200,
          { 'Cache-Control': 'public, max-age=60' }
        );
      }
      fetchUrl = realOrigin;
      resolvedOrigin = realOrigin;
    } catch (err) {
      return jsonResponse(
        { ok: false, error: 'sheet fetch failed', detail: err.message },
        200,
        { 'Cache-Control': 'public, max-age=30' }
      );
    }
  } else if (!ALLOWED_FALLBACK.test(parsed.hostname)) {
    return jsonResponse({ error: 'host not allowed' }, 403);
  }

  try {
    const upstream = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIWeb2026Hub/1.0; +https://aiweb2026.site)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });

    const html = await upstream.text();

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const rawTitle = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : null;
    const title = rawTitle ? decodeEntities(rawTitle) : null;

    const description = extractMeta(html, [
      /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:description["']/i,
      /<meta[^>]+name=["']twitter:description["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']description["']/i,
    ]);

    return jsonResponse(
      {
        ok: upstream.ok,
        status: upstream.status,
        title,
        description,
        origin: resolvedOrigin,
      },
      200,
      { 'Cache-Control': 'public, max-age=120' }
    );
  } catch (err) {
    const reason = err.name === 'TimeoutError' || err.name === 'AbortError'
      ? 'timeout'
      : 'fetch failed';
    return jsonResponse(
      { ok: false, error: reason, origin: resolvedOrigin },
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
