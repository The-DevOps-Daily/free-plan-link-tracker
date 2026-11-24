#!/usr/bin/env node
// Today's (UTC) free-plan usage for a whole Cloudflare account, from the
// GraphQL Analytics API: Workers requests and CPU, D1 rows read and written.
// Exits 1 when any of them is over the threshold, so a cron job can alert.
// The limits are per account, so this adds up every Worker and database.
//
// Needs a token with Account Analytics Read. It is read from the environment,
// never from the command line:
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/free-plan-usage.mjs [--threshold 0.5]
//
// The numbers are sampled estimates. Days with a few very large queries can
// swing a lot, so alert well below 100%. Schedule it with something that
// notifies on a non-zero exit (cron with MAILTO, a CI schedule, a monitor).

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) throw new Error("set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID");
const i = process.argv.indexOf("--threshold");
const threshold = i > 0 ? Number(process.argv[i + 1]) : 0.5;

const LIMITS = { requests: 100_000, rowsRead: 5_000_000, rowsWritten: 100_000, cpuMs: 10 };
const day = new Date().toISOString().slice(0, 10);

const query = `query ($account: String!, $day: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    w: workersInvocationsAdaptive(limit: 1000, filter: { date: $day }) {
      sum { requests errors }
      quantiles { cpuTimeP50 cpuTimeP99 }
      dimensions { scriptName }
    }
    d: d1AnalyticsAdaptiveGroups(limit: 1000, filter: { date: $day }) {
      sum { rowsRead rowsWritten }
    }
  } }
}`;

const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query, variables: { account, day } }),
});
const body = await res.json();
if (body.errors?.length) throw new Error(JSON.stringify(body.errors));
const acct = body.data.viewer.accounts[0];

const requests = acct.w.reduce((n, r) => n + r.sum.requests, 0);
const errors = acct.w.reduce((n, r) => n + r.sum.errors, 0);
const rowsRead = acct.d.reduce((n, r) => n + r.sum.rowsRead, 0);
const rowsWritten = acct.d.reduce((n, r) => n + r.sum.rowsWritten, 0);
const p99 = Math.max(0, ...acct.w.map((r) => r.quantiles.cpuTimeP99 / 1000));

const rows = [
  ["Workers requests", requests, LIMITS.requests],
  ["D1 rows read", rowsRead, LIMITS.rowsRead],
  ["D1 rows written", rowsWritten, LIMITS.rowsWritten],
];
// Day so far, and a straight-line guess for the full day. The guess is only
// printed: reads arrive in bursts, so it is a hint, not an alert condition.
const elapsed = (Date.now() - Date.parse(`${day}T00:00:00Z`)) / 86_400_000;
let over = false;
console.log(`${day} UTC, ${(elapsed * 100).toFixed(0)}% of the day gone`);
for (const [name, used, limit] of rows) {
  const share = used / limit;
  const projected = used / Math.max(elapsed, 1 / 24) / limit;
  if (share >= threshold) over = true;
  console.log(`${name.padEnd(17)} ${used.toLocaleString("en-US").padStart(11)} / ${limit.toLocaleString("en-US")}  ${(share * 100).toFixed(1)}% now, ~${(projected * 100).toFixed(0)}% by midnight`);
}
console.log(`Worker errors     ${errors}`);
console.log(`CPU p99 (worst Worker) ${p99.toFixed(1)} ms against the ${LIMITS.cpuMs} ms free limit`);
console.log(over ? `OVER ${Math.round(threshold * 100)}%` : `under ${Math.round(threshold * 100)}%`);
process.exit(over ? 1 : 0);
