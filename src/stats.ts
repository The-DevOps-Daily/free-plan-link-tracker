import type { Db } from "./db";
import { daysAgo, json, SLUG } from "./util";

type Day = { day: string; human: number; automated: number };

// Report for one link over the last `days` days. This is the read side, and
// on the free plan it is the side that grows: every report view reads rows in
// proportion to history, while a click or a beacon costs the same on day 1
// and on day 400.
// With no slug it is the dashboard view: every link at once. The primary keys
// of clicks and impression_totals start with slug, so a filter on day alone
// cannot use them and every row of both tables is read, whatever the range.
// An index on day would cut that, and cost one more row written per write to
// that table: cheap on impression_totals (only the cron writes it), not on
// clicks (every click writes it).
export async function handleStats(env: Env, db: Db, url: URL, slug: string | null): Promise<Response> {
  if (slug !== null && !SLUG.test(slug)) return json({ error: "bad slug" }, { status: 400 });
  if (slug === null) return handleDashboard(env, db, url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 30) || 30, 1), 730);
  const from = daysAgo(days - 1);

  const clicks = await db.all<Day>(
    db
      .prepare(
        `SELECT day, SUM(human) AS human, SUM(automated) AS automated
         FROM clicks WHERE slug = ?1 AND day >= ?2 GROUP BY day ORDER BY day`,
      )
      .bind(slug, from),
  );

  let impressions: Day[];
  if (env.STATS_MODE === "naive") {
    // No rollup: unpack every raw row in the range for every link, then
    // filter. Rows read grow with all traffic, not just this link's.
    impressions = await db.all<Day>(
      db
        .prepare(
          `SELECT r.day AS day, SUM(r.human) AS human, SUM(r.automated) AS automated
           FROM impressions_raw r, json_each(r.seen) j
           WHERE r.day >= ?2 AND substr(j.value, instr(j.value, ':') + 1) = ?1
           GROUP BY r.day ORDER BY r.day`,
        )
        .bind(slug, from),
    );
  } else {
    // Rolled-up days come from the totals (primary key starts with slug, so
    // only this link's rows are read). Raw rows not rolled up yet (today, and
    // any backlog the cron has not reached) are added from the raw table. The
    // rollup moves rows in one transaction, so nothing is counted twice.
    impressions = await db.all<Day>(
      db
        .prepare(
          `SELECT day, SUM(human) AS human, SUM(automated) AS automated FROM (
             SELECT day, human, automated FROM impression_totals WHERE slug = ?1 AND day >= ?2
             UNION ALL
             SELECT r.day, r.human, r.automated FROM impressions_raw r, json_each(r.seen) j
             WHERE r.day >= ?2 AND substr(j.value, instr(j.value, ':') + 1) = ?1
           ) GROUP BY day ORDER BY day`,
        )
        .bind(slug, from),
    );
  }

  const sum = (rows: Day[], k: "human" | "automated") => rows.reduce((n, r) => n + r[k], 0);
  return json({
    slug,
    days,
    mode: env.STATS_MODE,
    clicks: { human: sum(clicks, "human"), automated: sum(clicks, "automated") },
    impressions: { human: sum(impressions, "human"), automated: sum(impressions, "automated") },
    daily: { clicks, impressions },
  });
}

async function handleDashboard(env: Env, db: Db, url: URL): Promise<Response> {
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 30) || 30, 1), 730);
  const from = daysAgo(days - 1);
  type Row = { slug: string; human: number; automated: number };
  const clicks = await db.all<Row>(
    db
      .prepare("SELECT slug, SUM(human) AS human, SUM(automated) AS automated FROM clicks WHERE day >= ?1 GROUP BY slug ORDER BY slug")
      .bind(from),
  );
  const impressions = await db.all<Row>(
    db
      .prepare(
        env.STATS_MODE === "naive"
          ? `SELECT substr(j.value, instr(j.value, ':') + 1) AS slug, SUM(r.human) AS human, SUM(r.automated) AS automated
             FROM impressions_raw r, json_each(r.seen) j WHERE r.day >= ?1 GROUP BY 1 ORDER BY 1`
          : `SELECT slug, SUM(human) AS human, SUM(automated) AS automated FROM (
               SELECT slug, human, automated FROM impression_totals WHERE day >= ?1
               UNION ALL
               SELECT substr(j.value, instr(j.value, ':') + 1), r.human, r.automated
               FROM impressions_raw r, json_each(r.seen) j WHERE r.day >= ?1
             ) GROUP BY slug ORDER BY slug`,
      )
      .bind(from),
  );
  return json({ days, mode: env.STATS_MODE, clicks, impressions });
}
