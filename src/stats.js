/**
 * 학생 repo의 giscus 반응/댓글/최신 push 시간을 batch 수집.
 *
 * 흐름:
 *   1. 시트에서 학생 슬롯 → 진짜 origin 매핑 가져옴
 *   2. 학생 페이지 27개를 병렬 fetch → HTML에서 data-repo="owner/name" 추출
 *   3. GitHub GraphQL alias batch 쿼리로 repo별 pushedAt + discussions 조회
 *   4. discussions의 reactions/comments 합산
 *   5. 5분 캐싱
 *
 * GitHub Token은 Worker secret(GITHUB_TOKEN)으로 주입.
 */

import { getMapping } from "./sheet.js";

const CACHE_TTL = 300;
const FETCH_TIMEOUT_MS = 8000;

export async function getStats(ctx, env) {
  const cacheKey = new Request('https://cache.local/aiweb2026-hub-stats-v1');
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  if (!env?.GITHUB_TOKEN) {
    return { ok: false, error: 'GITHUB_TOKEN not configured', stats: {} };
  }

  // 1. 학생 origin 매핑
  const mapping = await getMapping(ctx);

  // 2. 학생 페이지 병렬 fetch + giscus repo 추출
  const slots = Object.keys(mapping).filter(s => /^s\d+$/.test(s));
  const repoEntries = await Promise.all(
    slots.map(async (slot) => {
      try {
        const repo = await extractRepoFromPage(mapping[slot]);
        return [slot, repo];
      } catch {
        return [slot, null];
      }
    })
  );
  const repos = Object.fromEntries(repoEntries.filter(([, r]) => r));

  // 3. GraphQL batch 쿼리
  const stats = await fetchGitHubStats(repos, env.GITHUB_TOKEN);

  const result = { ok: true, stats, fetchedAt: new Date().toISOString() };

  const cacheResponse = new Response(JSON.stringify(result), {
    headers: { 'Cache-Control': `max-age=${CACHE_TTL}` },
  });
  if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, cacheResponse));

  return result;
}

async function extractRepoFromPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AIWeb2026Hub/1.0)',
      'Accept': 'text/html',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const html = await res.text();

  // data-repo="owner/name" — 마지막 등장하는 것을 사용 (학생이 템플릿 교체한 값이 보통 뒤)
  const matches = [...html.matchAll(/data-repo=["']([^"'\/\s]+\/[^"'\s]+)["']/gi)];
  if (matches.length === 0) return null;

  const last = matches[matches.length - 1][1];
  const [owner, name] = last.split('/');
  if (!owner || !name) return null;

  // 영숫자/하이픈/언더스코어/점만 허용 (GraphQL injection 방지)
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) return null;

  return { owner, name };
}

async function fetchGitHubStats(repos, token) {
  const slots = Object.keys(repos);
  if (slots.length === 0) return {};

  const queryParts = slots.map(slot => {
    const { owner, name } = repos[slot];
    return `
      ${slot}: repository(owner: "${owner}", name: "${name}") {
        pushedAt
        discussions(first: 50) {
          totalCount
          nodes {
            reactions { totalCount }
            comments { totalCount }
          }
        }
      }`;
  }).join('\n');

  const query = `query { ${queryParts} }`;

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'aiweb2026-hub/1.0',
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    return Object.fromEntries(slots.map(s => [s, statsErr('http ' + res.status)]));
  }

  const data = await res.json();
  const stats = {};

  for (const slot of slots) {
    const repo = data?.data?.[slot];
    if (!repo) {
      stats[slot] = statsErr('repo not found');
      continue;
    }
    const nodes = repo.discussions?.nodes || [];
    const reactions = nodes.reduce((sum, n) => sum + (n.reactions?.totalCount || 0), 0);
    const comments = nodes.reduce((sum, n) => sum + (n.comments?.totalCount || 0), 0);
    stats[slot] = {
      ok: true,
      repo: `${repos[slot].owner}/${repos[slot].name}`,
      pushedAt: repo.pushedAt,
      discussionCount: repo.discussions?.totalCount || 0,
      reactions,
      comments,
    };
  }

  return stats;
}

function statsErr(reason) {
  return { ok: false, error: reason, reactions: 0, comments: 0, pushedAt: null };
}
