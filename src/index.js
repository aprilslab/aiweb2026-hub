import { handleMeta } from "./meta.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/meta") {
      return handleMeta(request, ctx);
    }

    // 나머지는 정적 자산(public/)으로 위임
    return env.ASSETS.fetch(request);
  },
};
