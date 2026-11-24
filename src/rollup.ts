import type { Db } from "./db";
import { today } from "./util";

export const ROLLUP_CHUNK = 1000;

// Moves closed days of raw impressions into per-link totals and deletes the
// raw rows, in one transaction. A run handles at most `chunk` raw rows, so a
// backlog (or a flood of forged beacons) drains over several hourly runs
// instead of spending the day's write allowance in one go.
export async function rollUp(db: Db, now = new Date(), chunk = ROLLUP_CHUNK): Promise<void> {
  const day = today(now);
  const pick = "SELECT day, seen FROM impressions_raw WHERE day < ?1 ORDER BY day, seen LIMIT ?2";
  await db.batch([
    db
      .prepare(
        `WITH picked AS (${pick})
         INSERT INTO impression_totals (slug, day, placement, human, automated)
         SELECT substr(j.value, instr(j.value, ':') + 1), r.day, substr(j.value, 1, instr(j.value, ':') - 1),
                SUM(r.human), SUM(r.automated)
         FROM impressions_raw r JOIN picked p ON p.day = r.day AND p.seen = r.seen, json_each(r.seen) j
         WHERE true
         GROUP BY 1, 2, 3
         ON CONFLICT (slug, day, placement) DO UPDATE SET
           human = human + excluded.human,
           automated = automated + excluded.automated`,
      )
      .bind(day, chunk),
    db.prepare(`DELETE FROM impressions_raw WHERE (day, seen) IN (${pick})`).bind(day, chunk),
  ]);
}
