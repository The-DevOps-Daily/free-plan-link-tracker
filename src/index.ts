import { handleBeacon } from "./beacon";
import { Db } from "./db";
import { handleRedirect } from "./links";
import { rollUp } from "./rollup";
import { handleStats } from "./stats";
import { json } from "./util";

function authorized(request: Request, env: Env): boolean {
  const token = env.ADMIN_TOKEN ?? "";
  if (token.length < 32) return false;
  const given = request.headers.get("Authorization") ?? "";
  const want = `Bearer ${token}`;
  if (given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

async function handleAdmin(request: Request, env: Env, db: Db, url: URL): Promise<Response> {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, { status: 401 });
  const stats = url.pathname.match(/^\/api\/stats(?:\/([^/]+))?$/);
  if (stats && request.method === "GET") return handleStats(env, db, url, stats[1] ?? null);
  // The same function the cron runs, callable on demand so its D1 cost can
  // be measured per run.
  if (url.pathname === "/api/rollup" && request.method === "POST") {
    await rollUp(db);
    return json({ ok: true });
  }
  return json({ error: "not found" }, { status: 404 });
}

async function route(request: Request, env: Env, ctx: ExecutionContext, db: Db): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/healthz") return new Response("ok\n");
  if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n");
  if (url.pathname === "/e") return handleBeacon(request, env, ctx, db);
  if (url.pathname.startsWith("/api/")) return handleAdmin(request, env, db, url);
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
  if (url.pathname === "/") return Response.redirect(env.FALLBACK_URL, 302);
  return handleRedirect(request, env, ctx, db, url);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const db = new Db(env.DB);
    const res = await route(request, env, ctx, db);
    if (env.METRICS !== "1") return res;
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(db.headers())) out.headers.set(k, v);
    return out;
  },

  async scheduled(_controller, env): Promise<void> {
    await rollUp(new Db(env.DB));
  },
} satisfies ExportedHandler<Env>;
