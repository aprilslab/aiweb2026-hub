import { handleMeta } from "./meta.js";
import { getStudentList } from "./sheet.js";
import { getStats } from "./stats.js";
import { getVotes } from "./votes.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/meta") {
      return handleMeta(request, ctx);
    }

    if (url.pathname === "/api/students") {
      return handleStudents(ctx);
    }

    if (url.pathname === "/api/stats") {
      return handleStats(ctx, env);
    }

    if (url.pathname === "/api/votes") {
      return handleVotes(ctx);
    }

    // 나머지는 정적 자산(public/)으로 위임
    return env.ASSETS.fetch(request);
  },
};

async function handleStudents(ctx) {
  try {
    const students = await getStudentList(ctx);
    return jsonResponse({ ok: true, students }, 200, {
      'Cache-Control': 'public, max-age=120',
    });
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err.message || 'sheet fetch failed' },
      200,
      { 'Cache-Control': 'public, max-age=30' }
    );
  }
}

async function handleStats(ctx, env) {
  try {
    const result = await getStats(ctx, env);
    return jsonResponse(result, 200, {
      'Cache-Control': 'public, max-age=300',
    });
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err.message || 'stats failed', stats: {} },
      200,
      { 'Cache-Control': 'public, max-age=30' }
    );
  }
}

async function handleVotes(ctx) {
  try {
    const result = await getVotes(ctx);
    // 짧은 엣지 캐시(20s) — 새 응답이 거의 바로 반영되게.
    // stale-while-revalidate: 만료돼도 즉시 옛값 주고 백그라운드 갱신 → 항상 빠름.
    return jsonResponse(result, 200, {
      'Cache-Control': 'public, max-age=20, stale-while-revalidate=40',
    });
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err.message || 'votes failed', votes: {}, maxVotes: 0 },
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
