import { isAutomated } from "./bots";
import type { Db } from "./db";
import { cleanPlacement, SLUG, today } from "./util";

type Link = { target_url: string; active: number };

const TTL_MS = 60_000;
const STALE_MS = 10 * 60_000;
const MAX_CACHED = 1_000;

// Each isolate keeps the links it has looked up for a minute, misses
// included. A popular link then costs one D1 read per isolate per minute
// instead of one per click. The price: a changed target can take a minute
// to show everywhere.
const cache = new Map<string, { link: Link | null; at: number }>();

// Returns undefined when D1 failed and there is no recent copy. If D1 fails
// (an outage, or the free plan's daily row limit), a copy up to 10 minutes
// old is used instead.
export async function findLink(db: Db, slug: string, now = Date.now()): Promise<Link | null | undefined> {
  const hit = cache.get(slug);
  if (hit && now - hit.at < TTL_MS) return hit.link;
  let rows: Link[];
  try {
    rows = await db.all<Link>(db.prepare("SELECT target_url, active FROM links WHERE slug = ?1").bind(slug));
  } catch (err) {
    console.error("link lookup failed", slug, err);
    return hit && now - hit.at < STALE_MS ? hit.link : undefined;
  }
  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(slug, { link: rows[0] ?? null, at: now });
  return rows[0] ?? null;
}

// The set of active slugs, for checking beacons, also kept for a minute.
let active: { slugs: Set<string>; at: number } | null = null;

export async function activeSlugs(db: Db, now = Date.now()): Promise<Set<string>> {
  if (active && now - active.at < TTL_MS) return active.slugs;
  const rows = await db.all<{ slug: string }>(db.prepare("SELECT slug FROM links WHERE active = 1"));
  active = { slugs: new Set(rows.map((r) => r.slug)), at: now };
  return active.slugs;
}

const UPSERT_CLICK = `
INSERT INTO clicks (slug, day, placement, human, automated) VALUES (?1, ?2, ?3, ?4, ?5)
ON CONFLICT (slug, day, placement) DO UPDATE SET
  human = human + excluded.human,
  automated = automated + excluded.automated`;

export async function handleRedirect(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  db: Db,
  url: URL,
): Promise<Response> {
  const slug = url.pathname.slice(1).toLowerCase();
  if (!SLUG.test(slug)) return new Response("Not found\n", { status: 404 });
  const link = await findLink(db, slug);
  // D1 is unavailable and this isolate has no recent copy: send the reader
  // somewhere useful rather than to an error page.
  if (link === undefined) return Response.redirect(env.FALLBACK_URL, 302);
  if (!link) return new Response("Not found\n", { status: 404 });
  if (!link.active) return Response.redirect(env.FALLBACK_URL, 302);

  const automated = isAutomated(request) ? 1 : 0;
  const write = db
    .run(db.prepare(UPSERT_CLICK).bind(slug, today(), cleanPlacement(url.searchParams.get("p")), 1 - automated, automated))
    .catch((err) => console.error("click not recorded", slug, err));
  // The reader never waits for the write. Metrics mode waits, so the
  // response can report the rows the write touched.
  if (env.METRICS === "1") await write;
  else ctx.waitUntil(write);
  return new Response(null, { status: 302, headers: { location: link.target_url, "cache-control": "no-store" } });
}
