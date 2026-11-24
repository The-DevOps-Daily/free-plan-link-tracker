#!/usr/bin/env node
// Measures, per request type, against a local `wrangler dev` (workerd):
//   - CPU ms per request: CPU time of the workerd processes (utime + stime
//     from /proc) before and after N sequential requests, divided by N, minus
//     the same number for /healthz, which touches no D1.
//   - D1 rows read and written per request, from the x-d1-* headers the
//     worker sets when METRICS=1 (summed from D1's own result meta).
// With --pipeline it measures nothing per request: it records the reports,
// runs the real rollup until there is nothing left to roll up (recording the
// rows and gross CPU of each run), and records the reports again.
// Linux only (reads /proc). Writes one JSON file and refuses to overwrite it.
// Usage: node scripts/measure.mjs --label totals [--base http://127.0.0.1:8797] [--n 400] [--repeats 3] [--pipeline 1]
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { openSync, readFileSync, readdirSync, writeSync, closeSync } from "node:fs";
import os from "node:os";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const BASE = args.base ?? "http://127.0.0.1:8797";
const N = Number(args.n ?? 400);
const REPEATS = Number(args.repeats ?? 3);
const LABEL = args.label ?? "run";
const OUT = args.out ?? `results/measure-${LABEL}.json`;
const ORIGIN = args.origin ?? "https://example.com";
const TOKEN = process.env.ADMIN_TOKEN ?? "";
if (TOKEN.length < 32) throw new Error("set ADMIN_TOKEN (the same value as in .dev.vars)");

const TICK_MS = 1000 / Number(execFileSync("getconf", ["CLK_TCK"]).toString().trim());

// Only workerd binaries from this checkout (wrangler dev runs two: the entry
// proxy and the runtime with the worker), so another project's wrangler dev
// on the same machine is never counted.
const OWN_WORKERD = `${process.cwd()}/node_modules/`;
function workerdPids() {
  const pids = [];
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const argv = readFileSync(`/proc/${d}/cmdline`, "utf8").split("\0");
      if (argv[0].startsWith(OWN_WORKERD) && argv[0].endsWith("/workerd") && argv[1] === "serve") pids.push(Number(d));
    } catch {}
  }
  if (pids.length === 0) throw new Error(`no workerd from ${OWN_WORKERD}: is wrangler dev running?`);
  return pids;
}

function cpuMs(pids) {
  let ticks = 0;
  for (const pid of pids) {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    ticks += Number(fields[11]) + Number(fields[12]); // utime, stime
  }
  return ticks * TICK_MS;
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

const auth = { Authorization: `Bearer ${TOKEN}` };
let miss = 0;
const scenarios = {
  healthz: () => [`${BASE}/healthz`, {}],
  "redirect (cached link)": () => [`${BASE}/link-01?p=sidebar`, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 measure" } }],
  "redirect HEAD (link checker)": () => [`${BASE}/link-02?p=inline`, { method: "HEAD", redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 measure" } }],
  "lookup miss (uncached)": () => [`${BASE}/no-such-link-${miss++}`, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 measure" } }],
  "beacon (3 links seen)": () => [
    `${BASE}/e`,
    {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "text/plain", "User-Agent": "Mozilla/5.0 measure" },
      body: JSON.stringify({ seen: ["sidebar:link-01", "inline:link-03", "footer:link-07"] }),
    },
  ],
  "stats 7 days": () => [`${BASE}/api/stats/link-01?days=7`, { headers: auth }],
  "stats 30 days": () => [`${BASE}/api/stats/link-01?days=30`, { headers: auth }],
  "stats 90 days": () => [`${BASE}/api/stats/link-01?days=90`, { headers: auth }],
  "stats 365 days": () => [`${BASE}/api/stats/link-01?days=365`, { headers: auth }],
  "dashboard 7 days": () => [`${BASE}/api/stats?days=7`, { headers: auth }],
  "dashboard 365 days": () => [`${BASE}/api/stats?days=365`, { headers: auth }],
};
// Fewer runs for the expensive report reads, so a run stays short.
const perScenarioN = (name) => (name.startsWith("stats") || name.startsWith("dashboard") ? Math.max(20, Math.floor(N / 8)) : N);

async function one(make) {
  const [url, init] = make();
  const t0 = performance.now();
  const res = await fetch(url, init);
  await res.arrayBuffer();
  return {
    status: res.status,
    ms: performance.now() - t0,
    read: Number(res.headers.get("x-d1-rows-read") ?? NaN),
    written: Number(res.headers.get("x-d1-rows-written") ?? NaN),
    queries: Number(res.headers.get("x-d1-queries") ?? NaN),
  };
}

async function measure(name) {
  const n = perScenarioN(name);
  for (let i = 0; i < 20; i++) await one(scenarios[name]); // warm the isolate and caches
  const pids = workerdPids();
  const before = cpuMs(pids);
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(await one(scenarios[name]));
  const cpu = (cpuMs(pids) - before) / n;
  const lat = rows.map((r) => r.ms).sort((a, b) => a - b);
  const statuses = [...new Set(rows.map((r) => r.status))];
  const mean = (k) => rows.reduce((s, r) => s + r[k], 0) / n;
  return {
    n,
    statuses,
    cpu_ms_per_req: cpu,
    rows_read_mean: mean("read"),
    rows_read_max: Math.max(...rows.map((r) => r.read)),
    rows_written_mean: mean("written"),
    rows_written_max: Math.max(...rows.map((r) => r.written)),
    queries_mean: mean("queries"),
    latency_ms_p50: percentile(lat, 0.5),
    latency_ms_p99: percentile(lat, 0.99),
  };
}

// The same report from both stats modes must match; this records it.
async function check() {
  const get = async (path) => {
    const res = await fetch(`${BASE}${path}`, { headers: auth });
    const { mode, ...rest } = await res.json();
    return { status: res.status, mode, rest };
  };
  const one = await get("/api/stats/link-01?days=365");
  const all = await get("/api/stats?days=365");
  const sha = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
  return {
    status: [one.status, all.status],
    mode: one.mode,
    sha256: sha([one.rest, all.rest]),
    impressions: one.rest.impressions,
    clicks: one.rest.clicks,
  };
}

// Gross CPU (no baseline subtracted): one request per run, and /proc counts
// in clock ticks, so a single run's CPU is coarse.
async function rollupUntilDone(maxRuns = 100) {
  const out = [];
  for (let i = 0; i < maxRuns; i++) {
    const pids = workerdPids();
    const before = cpuMs(pids);
    const r = await one(() => [`${BASE}/api/rollup`, { method: "POST", headers: auth }]);
    out.push({ ...r, gross_cpu_ms: cpuMs(pids) - before });
    if (r.status !== 200) throw new Error(`rollup returned ${r.status}`);
    if (r.written === 0) return out;
  }
  throw new Error(`rollup still writing after ${maxRuns} runs`);
}

function stamp() {
  const h = createHash("sha256");
  for (const dir of ["src", "migrations", "scripts"]) {
    for (const f of readdirSync(dir).sort()) h.update(f).update(readFileSync(`${dir}/${f}`));
  }
  for (const f of ["package.json", "wrangler.jsonc"]) h.update(readFileSync(f));
  return h.digest("hex").slice(0, 16);
}

const out = openSync(OUT, "wx"); // one writer per file; never append to an old run
const result = {
  label: LABEL,
  at: new Date().toISOString(),
  code_sha256: stamp(),
  host: { cpu: os.cpus()[0].model, cores: os.cpus().length, node: process.version, kernel: os.release(), loadavg_at_start: os.loadavg() },
  workerd_pids: workerdPids(),
  n: N,
  repeats: REPEATS,
  check: await check(),
  scenarios: {},
};
if (args.pipeline) {
  result.rollup = await rollupUntilDone();
  result.check_after_rollup = await check();
}
for (let r = 0; r < (args.pipeline ? 0 : REPEATS); r++) {
  for (const name of Object.keys(scenarios)) {
    (result.scenarios[name] ??= []).push(await measure(name));
    process.stderr.write(`${LABEL} repeat ${r + 1} ${name}: ${result.scenarios[name].at(-1).cpu_ms_per_req.toFixed(3)} ms\n`);
  }
}
result.host.loadavg_at_end = os.loadavg();
writeSync(out, JSON.stringify(result, null, 1) + "\n");
closeSync(out);
console.log(`wrote ${OUT}`);
