import { jsonResponse } from "./http";

type Cf = Record<string, unknown>;

// 服务端能直接返回的 request.cf 字段。
const WHOAMI_CF_FIELDS = [
  "country",
  "city",
  "region",
  "regionCode",
  "postalCode",
  "latitude",
  "longitude",
  "timezone",
  "continent",
  "isEUCountry",
  "asn",
  "asOrganization",
  "colo",
  "httpProtocol",
  "tlsVersion",
  "tlsCipher",
  "clientTcpRtt",
  "tlsClientHelloLength",
  "tlsClientExtensionsSha1",
];

// Cloudflare 自己加的头和 cookie 不属于“浏览器告诉网站的信息”，不返回。
const WHOAMI_SKIPPED_HEADERS =
  /^(cf-|x-forwarded-|x-real-ip$|cdn-loop$|cookie$|host$|connection$|true-client-ip$)/;

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function handleMe(
  request: Request,
  headers: Record<string, string>,
): Response {
  const cf = (request.cf ?? {}) as Cf;
  const ip = request.headers.get("CF-Connecting-IP");

  return jsonResponse(
    {
      ip,
      version: ip ? (ip.includes(":") ? 6 : 4) : null,
      country: cf.country ?? null,
      region: cf.region ?? null,
      city: cf.city ?? null,
      lat: numberOrNull(cf.latitude),
      lon: numberOrNull(cf.longitude),
      asn: cf.asn ?? null,
      org: cf.asOrganization ?? null,
      colo: cf.colo ?? null,
      http: cf.httpProtocol ?? null,
    },
    200,
    headers,
  );
}

function reverseDnsName(ip: string): string {
  if (!ip.includes(":")) {
    return `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
  }

  const [head = "", tail] = ip.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? headGroups
      : [
          ...headGroups,
          ...Array<string>(8 - headGroups.length - tailGroups.length).fill("0"),
          ...tailGroups,
        ];

  const nibbles = groups.map((group) => group.padStart(4, "0")).join("");
  return `${[...nibbles].reverse().join(".")}.ip6.arpa`;
}

// 没有 PTR 记录或查询超时都返回 null，不影响其他字段。
async function lookupPtr(ip: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(reverseDnsName(ip))}&type=PTR`,
      {
        headers: { Accept: "application/dns-json" },
        signal: AbortSignal.timeout(1500),
      },
    );
    const { Answer = [] } = (await response.json()) as {
      Answer?: { type: number; data: string }[];
    };
    const answer = Answer.find((record) => record.type === 12);
    return answer ? answer.data.replace(/\.$/, "") : null;
  } catch {
    return null;
  }
}

export async function handleWhoami(
  request: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const at = Date.now();
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const requestCf = (request.cf ?? {}) as Cf;

  const cf: Cf = {};
  for (const field of WHOAMI_CF_FIELDS) {
    const value = requestCf[field];
    if (value !== null && value !== undefined && value !== "") {
      cf[field] = value;
    }
  }

  const h: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    if (!WHOAMI_SKIPPED_HEADERS.test(name)) {
      h[name] = value;
    }
  });

  return jsonResponse(
    {
      ip,
      v: ip.includes(":") ? 6 : 4,
      cf,
      h,
      ptr: ip ? await lookupPtr(ip) : null,
      at,
    },
    200,
    headers,
  );
}
