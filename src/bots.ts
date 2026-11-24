const BOT_UA = /bot|crawl|spider|slurp|preview|monitor|checker|scanner|curl|wget|python-requests|go-http-client|headless/i;

// A rough split, good enough to keep link checkers and prefetches out of the
// human column. Nothing is dropped: automated requests are counted apart.
export function isAutomated(request: Request): boolean {
  if (request.method === "HEAD") return true;
  const purpose = `${request.headers.get("Sec-Purpose") ?? ""} ${request.headers.get("Purpose") ?? ""}`;
  if (/prefetch|prerender/i.test(purpose)) return true;
  const ua = request.headers.get("User-Agent") ?? "";
  return ua === "" || BOT_UA.test(ua);
}
