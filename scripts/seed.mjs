#!/usr/bin/env node
// Writes seed.sql: links, clicks and `days` days of impressions, in one of two
// shapes generated from the same random draws:
//   --shape totals  past days already rolled up into impression_totals (computed
//                   here), only today in impressions_raw: a database after the cron
//   --shape raw     every day still in impressions_raw: a database before the
//                   cron, or one that never rolls up (STATS_MODE=naive)
// Every mode must then return the same reports. measure.mjs checks that, and
// its --pipeline run rolls the raw shape up with the real rollup and checks
// the reports again.
// Usage: node scripts/seed.mjs [--shape totals|raw] [--links 12] [--days 400] [--combos 60] [--seed 42] [--out seed.sql]
import { writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const LINKS = Number(args.links ?? 12);
const DAYS = Number(args.days ?? 400);
const COMBOS = Number(args.combos ?? 60);
const SEED = Number(args.seed ?? 42);
const OUT = args.out ?? "seed.sql";
const SHAPE = args.shape ?? "totals";
if (!["totals", "raw"].includes(SHAPE)) throw new Error("--shape is totals or raw");
const PLACEMENTS = ["sidebar", "inline", "footer", "post"];

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const slugs = Array.from({ length: LINKS }, (_, i) => `link-${String(i + 1).padStart(2, "0")}`);
const now = Date.now();
const dayOf = (back) => new Date(now - back * 86_400_000).toISOString().slice(0, 10);

const links = slugs.map((s) => `('${s}','https://example.com/${s}',1)`);
const raw = new Map(); // `${day}|${seen}` -> [human, automated]
const clicks = new Map(); // `${slug}|${day}|${placement}` -> [human, automated]

// back = 0 is today: raw rows only, like a real day before the rollup.
for (let back = DAYS - 1; back >= 0; back--) {
  const day = dayOf(back);
  for (let c = 0; c < COMBOS; c++) {
    const entries = new Set();
    const k = int(1, 4);
    while (entries.size < k) entries.add(`${PLACEMENTS[int(0, PLACEMENTS.length - 1)]}:${slugs[int(0, LINKS - 1)]}`);
    const seen = JSON.stringify([...entries].sort());
    const key = `${day}|${seen}`;
    const cur = raw.get(key) ?? [0, 0];
    raw.set(key, [cur[0] + int(1, 400), cur[1] + int(0, 120)]);
  }
  for (const s of slugs) {
    for (const p of PLACEMENTS.slice(0, 2)) {
      if (rand() < 0.6) clicks.set(`${s}|${day}|${p}`, [int(0, 9), int(0, 4)]);
    }
  }
}

const totals = new Map(); // `${slug}|${day}|${placement}` -> [human, automated]
const todayStr = dayOf(0);
for (const [key, [h, a]] of raw) {
  const [day, seen] = key.split("|");
  if (day === todayStr) continue; // not rolled up yet
  for (const entry of JSON.parse(seen)) {
    const [placement, slug] = entry.split(":");
    const tk = `${slug}|${day}|${placement}`;
    const cur = totals.get(tk) ?? [0, 0];
    totals.set(tk, [cur[0] + h, cur[1] + a]);
  }
}

const q = (s) => `'${s.replaceAll("'", "''")}'`;
function inserts(table, cols, rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 400) {
    out.push(`INSERT INTO ${table} (${cols}) VALUES\n${rows.slice(i, i + 400).join(",\n")};`);
  }
  return out;
}
const rawRows = [...raw].filter(([k]) => SHAPE === "raw" || k.startsWith(`${todayStr}|`));
const totalRows = SHAPE === "totals" ? [...totals] : [];
const sql = [
  "DELETE FROM links; DELETE FROM clicks; DELETE FROM impressions_raw; DELETE FROM impression_totals;",
  ...inserts("links", "slug, target_url, active", links),
  ...inserts("impressions_raw", "day, seen, human, automated", rawRows.map(([k, [h, a]]) => {
    const [day, seen] = k.split("|");
    return `(${q(day)},${q(seen)},${h},${a})`;
  })),
  ...inserts("impression_totals", "slug, day, placement, human, automated", totalRows.map(([k, [h, a]]) => {
    const [slug, day, p] = k.split("|");
    return `(${q(slug)},${q(day)},${q(p)},${h},${a})`;
  })),
  ...inserts("clicks", "slug, day, placement, human, automated", [...clicks].map(([k, [h, a]]) => {
    const [slug, day, p] = k.split("|");
    return `(${q(slug)},${q(day)},${q(p)},${h},${a})`;
  })),
].join("\n");
writeFileSync(OUT, sql + "\n");
console.log(JSON.stringify({ out: OUT, shape: SHAPE, seed: SEED, links: LINKS, days: DAYS, combos: COMBOS, today: todayStr,
  rows: { impressions_raw: rawRows.length, impression_totals: totalRows.length, clicks: clicks.size } }));
