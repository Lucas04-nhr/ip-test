import { errorResponse } from "./http";

// 跳转链最后一跳的目标白名单。上游的静态规则可以跳到任意域名，这里收窄，避免成为开放重定向。
const HOP_TARGET_HOSTS = new Set([
  "www.netflix.com",
  "www.disneyplus.com",
  "www.peacocktv.com",
]);

const LAST_HOP_PATTERN = /^\/v1\/hop\/1\/([^/]+)(\/.*)?$/;

// /v1/hop/<n>/<host>/<path> 共跳转 n 次：n >= 2 由 public/_redirects 处理，这里只接最后一跳。
export function handleHop(url: URL, headers: Record<string, string>): Response {
  const match = LAST_HOP_PATTERN.exec(url.pathname);
  const host = match?.[1];

  if (!host) {
    return errorResponse("not_found", "Not found.", 404, headers);
  }

  const isSelf = host === url.host;

  if (!isSelf && !HOP_TARGET_HOSTS.has(host)) {
    return errorResponse(
      "hop_target_not_allowed",
      "This redirect target is not allowed.",
      403,
      headers,
    );
  }

  const scheme = isSelf ? url.protocol : "https:";

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${scheme}//${host}${match?.[2] ?? "/"}${url.search}`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
