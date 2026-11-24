-- A tracked link: /<slug> answers with a 302 to target_url.
CREATE TABLE links (
  slug TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
) WITHOUT ROWID;

-- One row per link, day and placement. A click is one upsert, so a link
-- clicked 10,000 times in a day is still one row.
CREATE TABLE clicks (
  slug TEXT NOT NULL,
  day TEXT NOT NULL,
  placement TEXT NOT NULL,
  human INTEGER NOT NULL DEFAULT 0,
  automated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day, placement)
) WITHOUT ROWID;

-- Raw impressions: one row per day and set of links seen on a page view.
-- A page view with four logos on screen is one write, not four.
CREATE TABLE impressions_raw (
  day TEXT NOT NULL,
  seen TEXT NOT NULL, -- JSON array of "placement:slug", sorted
  human INTEGER NOT NULL DEFAULT 0,
  automated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, seen)
) WITHOUT ROWID;

-- What reports read: per link, day and placement, filled by the hourly cron.
CREATE TABLE impression_totals (
  slug TEXT NOT NULL,
  day TEXT NOT NULL,
  placement TEXT NOT NULL,
  human INTEGER NOT NULL DEFAULT 0,
  automated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day, placement)
) WITHOUT ROWID;
