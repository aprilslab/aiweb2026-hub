import { handleMeta } from "./meta.js";
import { getStudentList } from "./sheet.js";
import { getStats } from "./stats.js";

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
