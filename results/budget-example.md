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
