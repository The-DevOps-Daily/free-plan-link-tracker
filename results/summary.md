Code d31efd00bb483f52, Intel(R) Xeon(R) Platinum 8280 CPU @ 2.70GHz (4 cores), Node v24.22.3, 5 repeats, medians.

## totals (results/measure-totals.json)

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

## naive (results/measure-naive.json)

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

## pipeline (results/measure-pipeline.json)

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
