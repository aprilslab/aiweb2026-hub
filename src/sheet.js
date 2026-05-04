/**
 * Google Sheet에서 학생 슬롯 매핑과 학생 목록을 읽어옴.
 *
 * aiweb-proxy Worker와 같은 시트/같은 컬럼 스키마를 공유한다:
 *   [이름, Domain, Page Link, Public IP]
 *
 * 두 가지 정보를 한 번에 파싱:
 *   - mapping:  { s01: "https://진짜origin/...", ... }   — /api/meta가 사용
 *   - students: [{ slot, name, url }, ...]              — /api/students가 사용
 *
 * Hub Worker가 *.aiweb2026.site로 직접 fetch 못하는 이유: 같은 zone의 다른
 * Worker(aiweb-proxy)로 라우팅되는데 Cloudflare가 cross-Worker subrequest
 * 차단(522). 그래서 진짜 외부 origin을 시트에서 조회 후 fetch 한다.
 */

const SHEET_ID = '1pDMyc5JPKs-61l5W0Vujw99z-HetFYmMjtWVj03ZiD4';
const ROOT_DOMAIN = 'aiweb2026.site';
const CACHE_TTL = 300; // 5분

// 시트에는 있지만 학생 갤러리에는 노출하지 않을 슬롯
// (mapping에는 남아있어 /api/meta는 동작, 갤러리 목록(students)에서만 제외)
const STUDENT_LIST_EXCLUDE = new Set(['example', 'test', 'demo']);

export const SHEET_ROOT_DOMAIN = ROOT_DOMAIN;

async function getSheetData(ctx) {
  const cacheKey = new Request('https://cache.local/aiweb2026-hub-sheet-v2');
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
  const response = await fetch(csvUrl, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Sheet fetch failed: ${response.status}`);

  const csv = await response.text();
  const data = parseSheet(csv);

  const cacheResponse = new Response(JSON.stringify(data), {
    headers: { 'Cache-Control': `max-age=${CACHE_TTL}` },
  });
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(cache.put(cacheKey, cacheResponse));
  }

  return data;
}

export async function getMapping(ctx) {
  const data = await getSheetData(ctx);
  return data.mapping;
}

export async function getStudentList(ctx) {
  const data = await getSheetData(ctx);
  return data.students;
}

function parseSheet(csv) {
  const lines = csv.split('\n').slice(1); // 헤더 제외
  const mapping = {};
  const students = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCSVLine(line);

    const name = cols[0]?.trim();
    const domainFull = cols[1]?.trim();
    const pageLink = cols[2]?.trim();
    if (!domainFull || !pageLink) continue;

    const subdomain = domainFull
      .replace(/^https?:\/\//, '')
      .replace(`.${ROOT_DOMAIN}`, '')
      .toLowerCase()
      .trim();
    if (!subdomain) continue;

    let normalizedUrl = pageLink;
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    mapping[subdomain] = normalizedUrl;
    if (!STUDENT_LIST_EXCLUDE.has(subdomain)) {
      students.push({
        slot: subdomain,
        name: name || subdomain,
        url: `https://${subdomain}.${ROOT_DOMAIN}`,
      });
    }
  }

  // 슬롯 코드 기준 정렬 (s01, s02, ..., s27)
  students.sort((a, b) => a.slot.localeCompare(b.slot, 'en', { numeric: true }));

  return { mapping, students };
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
