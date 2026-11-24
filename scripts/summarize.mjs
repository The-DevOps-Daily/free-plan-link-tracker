#!/usr/bin/env node
// Turns measure-*.json files into one Markdown table. Medians across repeats.
// Net CPU = the scenario's CPU per request minus /healthz from the same run.
// Usage: node scripts/summarize.mjs results/measure-totals.json [results/measure-naive.json]
import { readFileSync } from "node:fs";

const files = process.argv.slice(2).map((f) => ({ f, d: JSON.parse(readFileSync(f, "utf8")) }));
const stamps = new Set(files.map(({ d }) => d.code_sha256));
if (stamps.size !== 1) throw new Error(`refusing to mix runs of different code: ${[...stamps].join(", ")}`);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const f2 = (x) => (Math.abs(x) < 10 ? x.toFixed(2) : x.toFixed(0));

const out = [];
const { d: first } = files[0];
out.push(`Code ${first.code_sha256}, ${first.host.cpu} (${first.host.cores} cores), Node ${first.host.node}, ${first.repeats} repeats, medians.`);
out.push("");
for (const { f, d } of files) {
  out.push(`## ${d.label} (${f})`);
  out.push("");
  const names = Object.keys(d.scenarios);
  if (names.length > 0) {
    out.push("| request | n | net CPU ms/req | spread | rows read/req | rows written/req | D1 queries/req | p50 ms | status |");
    out.push("| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |");
    const base = d.scenarios.healthz.map((r) => r.cpu_ms_per_req);
    for (const name of names) {
      const runs = d.scenarios[name];
      const net = runs.map((r, i) => r.cpu_ms_per_req - base[i]);
      const shown = name === "healthz" ? runs.map((r) => r.cpu_ms_per_req) : net;
      out.push(
        `| ${name}${name === "healthz" ? " (gross, the baseline)" : ""} | ${runs[0].n} | ${f2(median(shown))} | ${f2(Math.min(...shown))} to ${f2(Math.max(...shown))} | ${f2(median(runs.map((r) => r.rows_read_mean)))} | ${f2(median(runs.map((r) => r.rows_written_mean)))} | ${f2(median(runs.map((r) => r.queries_mean)))} | ${f2(median(runs.map((r) => r.latency_ms_p50)))} | ${[...new Set(runs.flatMap((r) => r.statuses))].join(",")} |`,
      );
    }
    out.push("");
  }
  if (d.rollup) {
    const work = d.rollup.filter((r) => r.written > 0);
    const sum = (k) => work.reduce((n, r) => n + r[k], 0);
    out.push(`Rollup until nothing was left: ${d.rollup.length} runs (${work.length} with work, the last one found nothing). Gross CPU per run, coarse (clock ticks).`);
    out.push("");
    out.push("| | rows read | rows written | gross CPU ms | wall ms |");
    out.push("| --- | ---: | ---: | ---: | ---: |");
    out.push(`| median run with work | ${median(work.map((r) => r.read))} | ${median(work.map((r) => r.written))} | ${f2(median(work.map((r) => r.gross_cpu_ms)))} | ${f2(median(work.map((r) => r.ms)))} |`);
    out.push(`| all runs | ${sum("read")} | ${sum("written")} | ${f2(sum("gross_cpu_ms"))} | ${f2(sum("ms"))} |`);
    out.push("");
  }
}
const checks = files.flatMap(({ d }) => [[`${d.label}`, d.check], ...(d.check_after_rollup ? [[`${d.label} after rollup`, d.check_after_rollup]] : [])]);
const shas = new Set(checks.map(([, c]) => c.sha256));
out.push(`Report check (link-01 and the all-links dashboard, 365 days): ${shas.size === 1 ? "the same numbers in every run" : "MISMATCH"}`);
for (const [name, c] of checks) out.push(`- ${name}: ${JSON.stringify(c.impressions)} impressions, ${JSON.stringify(c.clicks)} clicks, ${c.sha256.slice(0, 12)}`);
console.log(out.join("\n"));
if (shas.size !== 1) process.exitCode = 1;
