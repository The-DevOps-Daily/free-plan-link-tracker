import { isAutomated } from "./bots";
import type { Db } from "./db";
import { activeSlugs } from "./links";
import { SLUG, today } from "./util";

const MAX_BODY = 2048;
const MAX_SEEN = 16;
const PLACEMENTS = new Set(["sidebar", "inline", "footer", "post", "banner"]);

const UPSERT_IMPRESSION = `
INSERT INTO impressions_raw (day, seen, human, automated) VALUES (?1, ?2, ?3, ?4)
ON CONFLICT (day, seen) DO UPDATE SET
  human = human + excluded.human,
  automated = automated + excluded.automated`;

// The page sends one beacon per page view with every tracked link that was
// on screen: {"seen": ["sidebar:acme", "inline:acme"]}, as text/plain so the
// browser skips the CORS preflight (a preflight would be a second request).
// The answer is always 204, whatever was counted.
export async function handleBeacon(request: Request, env: Env, ctx: ExecutionContext, db: Db): Promise<Response> {
  const done = new Response(null, { status: 204 });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  const origins = env.SITE_ORIGINS.split(",").map((o) => o.trim());
  if (!origins.includes(request.headers.get("Origin") ?? "")) return done;
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY) return done;
  const body = await request.text();
  if (body.length > MAX_BODY) return done;

  let seen: unknown;
  try {
    seen = (JSON.parse(body) as { seen?: unknown }).seen;
  } catch {
    return done;
  }
  if (!Array.isArray(seen)) return done;

  const work = (async () => {
    const slugs = await activeSlugs(db);
    const entries = new Set<string>();
    for (const item of seen.slice(0, MAX_SEEN)) {
      if (typeof item !== "string") continue;
      const [placement, slug] = item.toLowerCase().split(":", 2);
      if (PLACEMENTS.has(placement) && SLUG.test(slug ?? "") && slugs.has(slug)) entries.add(`${placement}:${slug}`);
    }
    if (entries.size === 0) return;
    const automated = isAutomated(request) ? 1 : 0;
    await db.run(db.prepare(UPSERT_IMPRESSION).bind(today(), JSON.stringify([...entries].sort()), 1 - automated, automated));
  })().catch((err) => console.error("beacon not recorded", err));

  if (env.METRICS === "1") await work;
  else ctx.waitUntil(work);
  return done;
}
