interface Env {
  DB: D1Database;
  FALLBACK_URL: string;
  SITE_ORIGINS: string;
  METRICS: string;
  STATS_MODE: string;
  ADMIN_TOKEN?: string;
}
