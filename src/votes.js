/**
 * 기말 투표 폼 응답 시트에서 작품별 득표 수 집계.
 *
 * 폼 응답 시트(Form_Responses) 컬럼:
 *   A 타임스탬프 | B 이메일 | C 본인 이름 | D 본인 아이디 | E 작품 5개 선택
 *
 * E열은 한 응답자가 고른 슬롯 5개가 쉼표로 들어있다:
 *   "s19, s21, s22, s25, s27"
 *
 * 모든 응답 행의 E열을 분해해 슬롯(sXX)별 등장 횟수를 센다.
 * → { s19: 3, s21: 1, ... }  (그 슬롯이 받은 표 수)
 *
 * Hub 카드 heatmap이 이 값을 maxVotes로 정규화해 glow 세기로 사용.
 */

import { parseCSVLine } from "./sheet.js";

// 구글 폼 응답이 모이는 스프레드시트 (학생 매핑 시트와 다름!)
const FORM_SHEET_ID = '1sMmRTuiFsgMtaB8GuJz2itNJMnXCM-taNdo8WH_nYfE';
const FORM_SHEET_NAME = 'Form_Responses';
const CACHE_TTL = 300; // 5분
const SELECTION_COL = 4; // E열 (0-based)

export async function getVotes(ctx) {
  const cacheKey = new Request('https://cache.local/aiweb2026-hub-votes-v1');
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  const csvUrl =
    `https://docs.google.com/spreadsheets/d/${FORM_SHEET_ID}/gviz/tq` +
    `?tqx=out:csv&sheet=${encodeURIComponent(FORM_SHEET_NAME)}`;
  const res = await fetch(csvUrl, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`votes sheet fetch failed: ${res.status}`);

  const csv = await res.text();
  const result = tally(csv);

  const cacheResponse = new Response(JSON.stringify(result), {
    headers: { 'Cache-Control': `max-age=${CACHE_TTL}` },
  });
  if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, cacheResponse));

  return result;
}

function tally(csv) {
  const lines = csv.split('\n').slice(1); // 헤더 제외
  const votes = {};
  let responses = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCSVLine(line);
    const selection = cols[SELECTION_COL]?.trim();
    if (!selection) continue;

    responses += 1;
    // "s19, s21, s22" → ["s19","s21","s22"]. 쉼표/공백 구분.
    for (const token of selection.split(/[,\s]+/)) {
      const slot = token.trim().toLowerCase();
      if (/^s\d+$/.test(slot)) {
        votes[slot] = (votes[slot] || 0) + 1;
      }
    }
  }

  let maxVotes = 0;
  for (const slot in votes) {
    if (votes[slot] > maxVotes) maxVotes = votes[slot];
  }

  return { ok: true, votes, maxVotes, responses, fetchedAt: new Date().toISOString() };
}
