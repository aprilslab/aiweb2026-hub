/**
 * Google Sheet에서 학생 슬롯 → 진짜 origin URL 매핑을 읽어옴.
 *
 * aiweb-proxy Worker와 같은 시트/같은 컬럼 스키마를 공유한다:
 *   [이름, Domain, Page Link, Public IP]
 *
 * Hub Worker가 학생 페이지를 직접 fetch하지 못하는 이유:
 *   *.aiweb2026.site는 같은 zone의 다른 Worker(aiweb-proxy)로 라우팅되는데,
 *   Cloudflare는 같은 zone 내 cross-Worker subrequest를 차단(522). 그래서
 *   진짜 외부 origin(Vercel/Netlify/...)을 직접 fetch한다.
 */

const SHEET_ID = '1pDMyc5JPKs-61l5W0Vujw99z-HetFYmMjtWVj03ZiD4';
const ROOT_DOMAIN = 'aiweb2026.site';
const CACHE_TTL = 300; // 5분

export const SHEET_ROOT_DOMAIN = ROOT_DOMAIN;

export async function getMapping(ctx) {
  const cacheKey = new Request('https://cache.local/aiweb2026-hub-sheet-mapping-v1');
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
  const response = await fetch(csvUrl, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Sheet fetch failed: ${response.status}`);

  const csv = await response.text();
  const mapping = parseSheet(csv);

  const cacheResponse = new Response(JSON.stringify(mapping), {
    headers: { 'Cache-Control': `max-age=${CACHE_TTL}` },
  });
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(cache.put(cacheKey, cacheResponse));
  }

  return mapping;
}

function parseSheet(csv) {
  const lines = csv.split('\n').slice(1);
  const mapping = {};

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCSVLine(line);

    const domainFull = cols[1]?.trim();
    const pageLink = cols[2]?.trim();
    if (!domainFull || !pageLink) continue;

    const subdomain = domainFull
      .replace(/^https?:\/\//, '')
      .replace(`.${ROOT_DOMAIN}`, '')
      .toLowerCase()
      .trim();

    let normalizedUrl = pageLink;
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    mapping[subdomain] = normalizedUrl;
  }

  return mapping;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}
