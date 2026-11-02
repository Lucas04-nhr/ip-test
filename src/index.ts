import { handleDns } from "./dns";
import { handleHop } from "./hop";
import { createApiHeaders, errorResponse, isAllowedOrigin } from "./http";
import { handleRoot } from "./legacy";
import { handleMe, handleWhoami } from "./me";

const ALLOWED_METHODS = "GET, OPTIONS";

type Handler = (
  request: Request,
  url: URL,
  headers: Record<string, string>,
) => Response | Promise<Response>;

interface Route {
  // 会发起外部请求的接口只接受博客来源，CORS 拦不住直接请求。
  originOnly?: boolean;
  handle: Handler;
}

const ROUTES: Record<string, Route> = {
  "/v1/me": {
    handle: (request, _url, headers) => handleMe(request, headers),
  },
  "/v1/whoami": {
    handle: (request, _url, headers) => handleWhoami(request, headers),
  },
  "/v1/dns": {
    originOnly: true,
    handle: (_request, url, headers) => handleDns(url, headers),
  },
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return handleRoot(request, url);
    }

    const origin = request.headers.get("Origin");

    if (url.pathname.startsWith("/v1/hop/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return errorResponse(
          "method_not_allowed",
          "Only GET and HEAD are supported.",
          405,
          { Allow: "GET, HEAD" },
        );
      }

      return handleHop(url, createApiHeaders(origin));
    }

    const route = ROUTES[url.pathname];
    const headers = createApiHeaders(origin);

    if (!route) {
      return errorResponse("not_found", "Not found.", 404, headers);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "GET") {
      return errorResponse(
        "method_not_allowed",
        "Only GET and OPTIONS are supported.",
        405,
        { ...headers, Allow: ALLOWED_METHODS },
      );
    }

    if (route.originOnly && !isAllowedOrigin(origin)) {
      return errorResponse(
        "origin_not_allowed",
        "This endpoint only accepts requests from allowed origins.",
        403,
        headers,
      );
    }

    return route.handle(request, url, headers);
  },
};
