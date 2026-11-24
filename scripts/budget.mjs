#!/usr/bin/env node
// Daily free-plan budget from measured per-request costs and your traffic.
// Reads a measure-*.json file, takes daily volumes, prints usage against the
// Workers Free and D1 Free daily limits, and how many times today's traffic
// each limit can take.
// Usage:
//   node scripts/budget.mjs results/measure-totals.json \
//     --rollup results/measure-pipeline.json \
//     --beacons 1200 --clicks 320 --heads 670 --other 400 --reports 40 --report-days 365 --dashboards 5 [--raw-rows N]
// --raw-rows is how many raw impression rows a day the cron rolls up. It
// defaults to the number of beacons, the upper bound (every page view its own
// row); real pages share rows when they show the same set of links.
import { readFileSync } from "node:fs";

const [file, ...rest] = process.argv.slice(2);
if (!file) throw new Error("usage: budget.mjs <measure.json> [--rollup measure-pipeline.json] [--beacons N] [--clicks N] [--heads N] [--other N] [--reports N] [--report-days 7|30|90|365] [--dashboards N] [--raw-rows N]");
const args = Object.fromEntries(rest.reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const d = JSON.parse(readFileSync(file, "utf8"));
const rollupRuns = args.rollup ? JSON.parse(readFileSync(args.rollup, "utf8")).rollup.filter((r) => r.written > 0) : null;
const num = (k, dflt) => Number(args[k] ?? dflt);

const LIMITS = { requests: 100_000, rowsWritten: 100_000, rowsRead: 5_000_000 }; // per day, reset 00:00 UTC
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const cost = (name) => {
  const runs = d.scenarios[name];
  if (!runs) throw new Error(`no scenario "${name}" in ${file}`);
  return { read: median(runs.map((r) => r.rows_read_mean)), written: median(runs.map((r) => r.rows_written_mean)) };
};

const reportDays = String(num("report-days", 30));
const lines = [
  { what: "beacons", n: num("beacons", 1200), c: cost("beacon (3 links seen)") },
  { what: "redirects", n: num("clicks", 320), c: cost("redirect (cached link)") },
  { what: "HEAD checks", n: num("heads", 670), c: cost("redirect HEAD (link checker)") },
  { what: "other (/, robots.txt)", n: num("other", 400), c: { read: 0, written: 0 } },
  { what: `report views (${reportDays} days)`, n: num("reports", 40), c: cost(`stats ${reportDays} days`) },
  { what: "dashboard views (all links)", n: num("dashboards", 5), c: cost("dashboard 365 days") },
];
// The hourly cron is 24 invocations a day. Its D1 cost scales with the raw
// rows it rolls up, at the per-row cost of the measured pipeline run (each run
// there handled up to 1,000 raw rows).
const rawPerDay = num("raw-rows", num("beacons", 1200));
if (rollupRuns && rollupRuns.length > 0) {
  const per = { read: median(rollupRuns.map((r) => r.read)) / 1000, written: median(rollupRuns.map((r) => r.written)) / 1000 };
  lines.push({ what: `hourly cron rolling up ${rawPerDay.toLocaleString("en-US")} raw rows`, n: rawPerDay, c: per, requests: 24 });
} else {
  lines.push({ what: "hourly cron (rollup cost not counted: pass --rollup)", n: 24, c: { read: 0, written: 0 } });
}

let req = 0, read = 0, written = 0;
console.log("| source | per day | rows read | rows written |\n| --- | ---: | ---: | ---: |");
for (const l of lines) {
  const r = l.n * l.c.read, w = l.n * l.c.written;
  req += l.requests ?? l.n;
  read += r;
  written += w;
  console.log(`| ${l.what} | ${l.n.toLocaleString("en-US")} | ${Math.round(r).toLocaleString("en-US")} | ${Math.round(w).toLocaleString("en-US")} |`);
}
const pct = (x, lim) => `${((100 * x) / lim).toFixed(1)}%`;
console.log("");
console.log(`Requests ${req.toLocaleString("en-US")} / 100,000 (${pct(req, LIMITS.requests)})`);
console.log(`D1 rows read ${Math.round(read).toLocaleString("en-US")} / 5,000,000 (${pct(read, LIMITS.rowsRead)})`);
console.log(`D1 rows written ${Math.round(written).toLocaleString("en-US")} / 100,000 (${pct(written, LIMITS.rowsWritten)})`);
const headroom = [
  ["requests", LIMITS.requests / req],
  ["rows read", read ? LIMITS.rowsRead / read : Infinity],
  ["rows written", written ? LIMITS.rowsWritten / written : Infinity],
].sort((a, b) => a[1] - b[1]);
console.log(`First limit if every line grows together: ${headroom[0][0]}, at ${headroom[0][1].toFixed(1)}x today's volume.`);
const reportRows = cost(`stats ${reportDays} days`).read;
if (reportRows > 0) console.log(`Report views alone: up to ${Math.floor(LIMITS.rowsRead / reportRows).toLocaleString("en-US")} a day fit in the read limit (${reportRows.toFixed(0)} rows each).`);
console.log("Not counted: per-isolate cache loads (a beacon or redirect on a cold isolate reads the link list or the link), and failed or retried writes.");
