const ALLOWED_ORIGIN_PATTERN =
  /^https:\/\/([a-z0-9-]+\.)*lucas04\.top(?::\d+)?$/i;

const DEV_ALLOWED_ORIGINS = new Set([
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) {
    return false;
  }

  return (
    DEV_ALLOWED_ORIGINS.has(origin) ||
    ALLOWED_ORIGIN_PATTERN.test(origin)
  );
}

export function createCorsHeaders(
  origin: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: "Origin",
  };

  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin as string;
    headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }

  return headers;
}

// 前端跨域后，测时延要靠这个头才能读到详细的 Resource Timing。
export function createApiHeaders(
  origin: string | null,
): Record<string, string> {
  const headers = createCorsHeaders(origin);

  if (isAllowedOrigin(origin)) {
    headers["Timing-Allow-Origin"] = origin as string;
  }

  return headers;
}

export function jsonResponse(
  data: unknown,
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  headers: Record<string, string>,
): Response {
  return jsonResponse({ error: { code, message } }, status, headers);
}
