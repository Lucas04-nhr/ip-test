// GET / 的响应结构被博客的 debugInfo、rawJsonOutput 和中国大陆用户检测直接依赖，保持不变。
import { createCorsHeaders, errorResponse, jsonResponse } from "./http";

const API_VERSION = "2.0.0";

// cookie 与 x-real-ip 不在此列表，因此会原样返回。
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
  "x-csrf-token",
  "x-forwarded-for",
  "forwarded",
  "true-client-ip",
]);

type Group = Record<string, unknown>;

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized !== "" && normalized !== "n/a";
  }

  return true;
}

function setIfPresent(target: Group, key: string, value: unknown): void {
  if (hasValue(value)) {
    target[key] = value;
  }
}

function addGroupIfNotEmpty(target: Group, key: string, value: Group): void {
  if (Object.keys(value).length > 0) {
    target[key] = value;
  }
}

function numberIfPresent(value: unknown): number | undefined {
  if (!hasValue(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function detectIpVersion(ip: string | null | undefined): number | undefined {
  if (!ip || !hasValue(ip)) {
    return undefined;
  }

  if (ip.includes(":")) {
    return 6;
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    return 4;
  }

  return undefined;
}

function parseClientHintBoolean(value: string | null): boolean | undefined {
  if (value === "?1") {
    return true;
  }

  if (value === "?0") {
    return false;
  }

  return undefined;
}

function getSafeReferrerOrigin(referrer: string | null): string | undefined {
  if (!referrer || !hasValue(referrer)) {
    return undefined;
  }

  try {
    return new URL(referrer).origin;
  } catch {
    return undefined;
  }
}

function getReturnedHeaders(headers: Headers): Group {
  const values: Record<string, string> = {};
  const redacted: string[] = [];

  headers.forEach((value, name) => {
    const lowerName = name.toLowerCase();

    // cf-* 已被单独组织到 IP、edge、security 等字段中。
    if (lowerName.startsWith("cf-")) {
      return;
    }

    if (SENSITIVE_HEADERS.has(lowerName)) {
      values[name] = "[REDACTED]";
      redacted.push(name);
      return;
    }

    // cookie 和 x-real-ip 会走这里并原样保留。
    values[name] = value;
  });

  const result: Group = { values };

  if (redacted.length > 0) {
    result.redacted = redacted;
  }

  return result;
}

export function handleRoot(request: Request, url: URL): Response {
  const startedAt = Date.now();
  const origin = request.headers.get("Origin");
  const corsHeaders = createCorsHeaders(origin);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (request.method !== "GET") {
    return errorResponse(
      "method_not_allowed",
      "Only GET and OPTIONS are supported.",
      405,
      {
        ...corsHeaders,
        Allow: "GET, OPTIONS",
      },
    );
  }

  const cf = (request.cf ?? {}) as Record<string, any>;

  const cfConnectingIp = request.headers.get("CF-Connecting-IP");
  const xRealIp = request.headers.get("X-Real-IP");

  const clientIp = hasValue(cfConnectingIp)
    ? cfConnectingIp
    : hasValue(xRealIp)
      ? xRealIp
      : undefined;

  const ipSource = hasValue(cfConnectingIp)
    ? "CF-Connecting-IP"
    : hasValue(xRealIp)
      ? "X-Real-IP"
      : undefined;

  const includeHeaders = url.searchParams.get("headers") !== "0";

  const data: Group = {};

  const ip: Group = {};
  setIfPresent(ip, "address", clientIp);
  setIfPresent(ip, "version", detectIpVersion(clientIp));
  setIfPresent(ip, "source", ipSource);
  addGroupIfNotEmpty(data, "ip", ip);

  const geo: Group = {};
  setIfPresent(geo, "continentCode", cf.continent);
  setIfPresent(geo, "countryCode", cf.country);

  if (hasValue(cf.isEUCountry)) {
    geo.isEU = cf.isEUCountry === "1" || cf.isEUCountry === true;
  }

  const region: Group = {};
  setIfPresent(region, "name", cf.region);
  setIfPresent(region, "code", cf.regionCode);
  addGroupIfNotEmpty(geo, "region", region);

  setIfPresent(geo, "city", cf.city);
  setIfPresent(geo, "postalCode", cf.postalCode);
  setIfPresent(geo, "metroCode", cf.metroCode);

  const coordinates: Group = {};
  setIfPresent(coordinates, "latitude", numberIfPresent(cf.latitude));
  setIfPresent(coordinates, "longitude", numberIfPresent(cf.longitude));
  addGroupIfNotEmpty(geo, "coordinates", coordinates);

  setIfPresent(geo, "timezone", cf.timezone);
  addGroupIfNotEmpty(data, "geo", geo);

  const network: Group = {};
  setIfPresent(network, "asn", numberIfPresent(cf.asn));
  setIfPresent(network, "asOrganization", cf.asOrganization);

  const connection: Group = {};

  if (hasValue(cf.clientQuicRtt)) {
    connection.transport = "quic";
    setIfPresent(connection, "rttMs", numberIfPresent(cf.clientQuicRtt));
  } else if (hasValue(cf.clientTcpRtt)) {
    connection.transport = "tcp";
    setIfPresent(connection, "rttMs", numberIfPresent(cf.clientTcpRtt));
  }

  setIfPresent(
    connection,
    "deliveryRateBps",
    numberIfPresent(cf.edgeL4?.deliveryRate),
  );

  addGroupIfNotEmpty(network, "connection", connection);
  addGroupIfNotEmpty(data, "network", network);

  const security: Group = {};
  const tls: Group = {};

  setIfPresent(tls, "version", cf.tlsVersion);
  setIfPresent(tls, "cipher", cf.tlsCipher);

  if (cf.tlsClientAuth !== null && cf.tlsClientAuth !== undefined) {
    tls.clientCertificatePresented = Boolean(cf.tlsClientAuth);
  }

  addGroupIfNotEmpty(security, "tls", tls);
  addGroupIfNotEmpty(data, "security", security);

  const client: Group = {};
  setIfPresent(client, "userAgent", request.headers.get("User-Agent"));
  setIfPresent(client, "acceptLanguage", request.headers.get("Accept-Language"));

  setIfPresent(
    client,
    "acceptEncoding",
    cf.clientAcceptEncoding ?? request.headers.get("Accept-Encoding"),
  );

  setIfPresent(
    client,
    "platform",
    request.headers.get("Sec-CH-UA-Platform"),
  );

  setIfPresent(
    client,
    "mobile",
    parseClientHintBoolean(request.headers.get("Sec-CH-UA-Mobile")),
  );

  addGroupIfNotEmpty(data, "client", client);

  const edge: Group = {};
  setIfPresent(edge, "colo", cf.colo);
  setIfPresent(edge, "rayId", request.headers.get("CF-Ray"));
  addGroupIfNotEmpty(data, "edge", edge);

  const requestInfo: Group = {
    method: request.method,
    url: {
      scheme: url.protocol.replace(":", ""),
      host: url.host,
      pathname: url.pathname,
      queryKeys: [...new Set(url.searchParams.keys())],
    },
  };

  setIfPresent(requestInfo, "httpProtocol", cf.httpProtocol);

  setIfPresent(
    requestInfo,
    "priority",
    cf.requestPriority ?? request.headers.get("Priority"),
  );

  setIfPresent(
    requestInfo,
    "referrerOrigin",
    getSafeReferrerOrigin(request.headers.get("Referer")),
  );

  data.request = requestInfo;

  if (includeHeaders) {
    data.headers = getReturnedHeaders(request.headers);
  }

  data.api = {
    version: API_VERSION,
    generatedAt: new Date().toISOString(),
    processingTimeMs: Date.now() - startedAt,
    cache: "no-store",
  };

  return jsonResponse(data, 200, corsHeaders);
}
