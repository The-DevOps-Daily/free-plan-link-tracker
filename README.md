# free-plan-link-tracker

A small link tracker (302 redirects, an impression beacon, an hourly rollup, per-link reports) on Cloudflare Workers and D1, written to stay inside the **Workers Free** plan, plus the scripts that measure what each request costs against the free limits: CPU ms, D1 rows read and D1 rows written.

```bash
npm ci                      # Node.js 22 or later
scripts/run-all.sh          # Linux (reads /proc); runs wrangler dev locally, no Cloudflare account needed
cat results/summary.md
```

It is the open, generic version of the pattern behind the link tracker we run in production. The write-up, with 30 days of production numbers next to these, is on DevOps Daily: [A link tracker on the Cloudflare free plan, measured](https://devops-daily.com/posts/cloudflare-free-plan-link-tracker-limits-measured).

## The free limits it is built around

| Limit (Workers Free) | Value | What the code does about it |
| --- | --- | --- |
| Requests | 100,000 a day, account wide | One request per click and one per page view. The beacon is `text/plain`, so the browser sends no CORS preflight. |
| CPU | 10 ms per invocation, some leniency | No crypto or parsing beyond one small JSON body on the hot path. SQL runs in D1, not in the isolate. |
| D1 rows written | 100,000 a day | A click is one upsert into a per-day row. A page view is one upsert, however many links were on screen. No secondary indexes (each one adds a written row). |
| D1 rows read | 5,000,000 a day | Links and the set of active links are cached per isolate for 60 seconds. Reports read rolled-up totals keyed by link, plus only the raw rows not rolled up yet. |
| Cron Triggers | 5 per account | One, hourly. Each run rolls up at most 1,000 raw rows, so a backlog drains over hours instead of spending the day's writes. |
| Subrequests | 50 per invocation (1,000 to Cloudflare services such as D1) | No fetches to the internet on the hot path. |

## What is in here

- `src/index.ts`: routes. `/<slug>` redirects, `POST /e` takes beacons, `/api/stats/<slug>` is one link's report, `/api/stats` is the all-links dashboard, `POST /api/rollup` runs the cron's rollup on demand. `/api/*` needs `Authorization: Bearer $ADMIN_TOKEN`.
- `src/db.ts`: a wrapper that adds up `rows_read` and `rows_written` from the meta D1 returns with each result. With `METRICS=1`, every response carries `x-d1-rows-read`, `x-d1-rows-written` and `x-d1-queries`, and writes are awaited so the numbers are complete. With `METRICS=0` (the default) the redirect never waits for its write (`ctx.waitUntil`).
- `src/links.ts`: the redirect. If the D1 lookup fails (an outage, or the daily row limit), it uses a cached copy of the link up to 10 minutes old, or sends the reader to `FALLBACK_URL`. Never an error page.
- `src/rollup.ts`: the hourly job. Closed days of raw impressions go into `impression_totals`, the raw rows are deleted, in one transaction.
- `src/stats.ts`: reports. `STATS_MODE=totals` reads the rolled-up rows plus any raw rows not rolled up yet (today, or a backlog), so a report is complete at any moment; `STATS_MODE=naive` never uses the totals and unpacks every raw row in the range, which is what reads cost without the rollup.
- `scripts/seed.mjs`: deterministic history (mulberry32, seed 42): 12 links, 400 days, 60 sets of links seen per day, as of the day it runs. `--shape totals` writes past days as totals (computed in the script) and only today as raw rows, like a database after the cron; `--shape raw` writes every day as raw rows, like one before it.
- `scripts/measure.mjs`: sends N sequential requests per request type to `wrangler dev` and records CPU per request (utime + stime of this checkout's `workerd` processes from `/proc`, minus `/healthz`, which touches no D1) and the D1 rows from the response headers. It records a one-link report and the all-links dashboard as a check, stamps the output with a hash of the code, and refuses to overwrite an existing results file. With `--pipeline 1` it instead runs the real rollup until nothing is left, recording each run, and records the reports again.
- `scripts/run-all.sh`: three runs on fresh local databases: `totals` (rolled-up seed, totals reports), `naive` (raw seed, raw reports) and `pipeline` (raw seed, rolled up by the real rollup). All reports, before and after the rollup, must match.
- `scripts/summarize.mjs`: medians across repeats, as a Markdown table, and the report check. Refuses to mix runs of different code, and exits 1 if any report differs.
- `scripts/budget.mjs`: your daily volumes times the measured per-request costs, against the daily limits.
- `scripts/free-plan-usage.mjs`: today's usage for a real account from the GraphQL Analytics API (Workers requests, CPU p99, D1 rows read and written), exit 1 when any is over a threshold (50% by default; we run it with `--threshold 0.4`, because the numbers are sampled). Schedule it with something that notifies on a non-zero exit. The token comes from `CLOUDFLARE_API_TOKEN` in the environment, never from the command line, and needs Account Analytics Read.
- `production/`: aggregate numbers from our own tracker (daily requests for this Worker, CPU percentiles, D1 rows, storage, CPU per request type over 72 hours, the daily report sync's reads, the two D1 datasets side by side, and the usage script's output). No paths, link names or counts per link.

## Results

Measured 2026-11-24 on a throwaway 4 vCPU CPU-optimized DigitalOcean droplet (Ubuntu 24.04), wrangler 4.158.0 (workerd 2026-11-04), 400 requests per type (50 for reports), 5 repeats. Full output: [`results/summary.md`](results/summary.md), raw files: `results/measure-*.json`.

Code d31efd00bb483f52, Intel(R) Xeon(R) Platinum 8280 CPU @ 2.70GHz (4 cores), Node v24.22.3, 5 repeats, medians.

### totals (results/measure-totals.json)

| request | n | net CPU ms/req | spread | rows read/req | rows written/req | D1 queries/req | p50 ms | status |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| healthz (gross, the baseline) | 400 | 4.47 | 4.03 to 4.95 | 0.00 | 0.00 | 0.00 | 4.09 | 200 |
| redirect (cached link) | 400 | 1.70 | 1.35 to 1.85 | 0.00 | 1.00 | 1.00 | 6.91 | 302 |
| redirect HEAD (link checker) | 400 | 1.65 | 1.17 to 1.85 | 0.00 | 1.00 | 1.00 | 7.05 | 302 |
| lookup miss (uncached) | 400 | 1.68 | 1.65 to 1.88 | 0.00 | 0.00 | 1.00 | 5.63 | 404 |
| beacon (3 links seen) | 400 | 1.30 | 1.15 to 2.07 | 0.00 | 1.00 | 1.00 | 6.50 | 204 |
| stats 7 days | 50 | 3.33 | 2.10 to 4.25 | 301 | 0.00 | 2.00 | 7.32 | 200 |
| stats 30 days | 50 | 3.13 | 2.25 to 4.15 | 507 | 0.00 | 2.00 | 7.16 | 200 |
| stats 90 days | 50 | 4.15 | 2.85 to 7.93 | 1036 | 0.00 | 2.00 | 7.86 | 200 |
| stats 365 days | 50 | 6.72 | 5.25 to 7.57 | 3471 | 0.00 | 2.00 | 11 | 200 |
| dashboard 7 days | 50 | 4.93 | 4.25 to 5.17 | 24847 | 0.00 | 2.00 | 9.05 | 200 |
| dashboard 365 days | 50 | 11 | 10 to 12 | 41383 | 0.00 | 2.00 | 15 | 200 |

### naive (results/measure-naive.json)

| request | n | net CPU ms/req | spread | rows read/req | rows written/req | D1 queries/req | p50 ms | status |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| healthz (gross, the baseline) | 400 | 4.13 | 3.90 to 4.35 | 0.00 | 0.00 | 0.00 | 4.07 | 200 |
| redirect (cached link) | 400 | 1.55 | 0.95 to 1.88 | 0.00 | 1.00 | 1.00 | 6.64 | 302 |
| redirect HEAD (link checker) | 400 | 1.63 | 1.03 to 1.75 | 0.00 | 1.00 | 1.00 | 6.86 | 302 |
| lookup miss (uncached) | 400 | 1.60 | 1.38 to 2.08 | 0.00 | 0.00 | 1.00 | 5.49 | 404 |
| beacon (3 links seen) | 400 | 1.58 | 1.40 to 1.75 | 0.00 | 1.00 | 1.00 | 6.56 | 204 |
| stats 7 days | 50 | 3.10 | 2.65 to 3.88 | 1468 | 0.00 | 2.00 | 7.22 | 200 |
| stats 30 days | 50 | 5.00 | 4.47 to 5.50 | 6233 | 0.00 | 2.00 | 8.68 | 200 |
| stats 90 days | 50 | 8.70 | 8.60 to 15 | 18493 | 0.00 | 2.00 | 13 | 200 |
| stats 365 days | 50 | 25 | 25 to 25 | 75437 | 0.00 | 2.00 | 29 | 200 |
| dashboard 7 days | 50 | 4.40 | 3.45 to 5.10 | 8268 | 0.00 | 2.00 | 8.35 | 200 |
| dashboard 365 days | 50 | 50 | 49 to 50 | 134712 | 0.00 | 2.00 | 53 | 200 |

### pipeline (results/measure-pipeline.json)

Rollup until nothing was left: 25 runs (24 with work, the last one found nothing). Gross CPU per run, coarse (clock ticks).

| | rows read | rows written | gross CPU ms | wall ms |
| --- | ---: | ---: | ---: | ---: |
| median run with work | 11130 | 1817 | 10 | 17 |
| all runs | 256038 | 41826 | 360 | 410 |

Report check (link-01 and the all-links dashboard, 365 days): the same numbers in every run
- totals: {"human":910685,"automated":276432} impressions, {"human":1946,"automated":851} clicks, fefe64e32916
- naive: {"human":910685,"automated":276432} impressions, {"human":1946,"automated":851} clicks, fefe64e32916
- pipeline: {"human":910685,"automated":276432} impressions, {"human":1946,"automated":851} clicks, fefe64e32916
- pipeline after rollup: {"human":910685,"automated":276432} impressions, {"human":1946,"automated":851} clicks, fefe64e32916

What to take from it, and what not to:

- **D1 rows per request are exact counts** from D1's own result meta for this fixture and runtime, not sampled estimates, and they do not depend on the machine. A redirect for a cached link and a beacon each write 1 row and read none. A report for one link reads rows in proportion to its history. The all-links dashboard reads every row of `impression_totals` and `clicks` whatever the range, because both primary keys start with the link.
- **The pipeline run starts from raw rows only.** The real rollup took 24 runs to move the 399 closed days of raw rows into totals (1,000 raw rows per run; today's 58 rows stay raw until tomorrow), and the reports matched before, after, and in the other two runs.
- **CPU per request is only good for comparing request types on this machine.** Local D1 runs SQLite inside the same `workerd` process, so local CPU includes query work that Cloudflare does not count as your Worker's CPU. In production, no dashboard API request used more than 5 ms of Worker CPU in the same 72 hours in which a daily sync read about 800,000 rows a day (the exports do not pair each request with its rows).
- The rollup CPU is gross (no baseline subtracted), one request per run, and `/proc` counts CPU in 10 ms ticks, so it is "about 10 ms".
- The data is synthetic. The ratio between the modes depends on how many links share a page view (here 1 to 4) and how many distinct sets there are per day (here 60).
- The measured redirect and beacon hit a warm cache. On a cold isolate, a beacon also loads the active-link list (one row per active link) and a redirect reads its link (about 1 row). In production most beacons paid for that load.

## Budget example

```bash
node scripts/budget.mjs results/measure-totals.json --rollup results/measure-pipeline.json
# defaults: 1,200 beacons, 320 clicks, 670 HEAD checks, 400 other, 40 reports (30 days), 5 dashboards, raw rows = beacons
```

| source | per day | rows read | rows written |
| --- | ---: | ---: | ---: |
| beacons | 1,200 | 0 | 1,200 |
| redirects | 320 | 0 | 320 |
| HEAD checks | 670 | 0 | 670 |
| other (/, robots.txt) | 400 | 0 | 0 |
| report views (30 days) | 40 | 20,280 | 0 |
| dashboard views (all links) | 5 | 206,915 | 0 |
| hourly cron rolling up 1,200 raw rows | 1,200 | 13,358 | 2,180 |

Requests 2,659 / 100,000 (2.7%)
D1 rows read 240,553 / 5,000,000 (4.8%)
D1 rows written 4,370 / 100,000 (4.4%)
First limit if every line grows together: rows read, at 20.8x today's volume.
Report views alone: up to 9,861 a day fit in the read limit (507 rows each).
Not counted: per-isolate cache loads (a beacon or redirect on a cold isolate reads the link list or the link), and failed or retried writes.

## Deploy (optional)

Everything above runs locally. To run it on a free account:

```bash
npx wrangler d1 create free-plan-link-tracker     # put the id in wrangler.jsonc
npx wrangler d1 migrations apply DB --remote
openssl rand -base64 36 | tr -d '=+/' | npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

Set `SITE_ORIGINS` to the pages that may send beacons and `FALLBACK_URL` to where inactive links should go.

## Raspberry Pi

The stock `workerd` binary would not start on our Raspberry Pi, whose kernel gives processes a 39-bit virtual address space. We ran everything on x86-64 cloud VMs.

## License

MIT

## A method note

The first full run was on a shared development box, and `measure.mjs` then summed the CPU of every `workerd serve` process on the machine, which included unrelated processes. Rows read and written were identical to the final run (they come from D1's meta, not the machine), but the CPU spread went negative. `measure.mjs` now counts only the `workerd` binaries from this checkout, records their PIDs and the load average in the results, and the published numbers come from a clean, otherwise idle droplet.
