import { errorResponse } from "./http";

const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;

interface DnsAnswer {
  type: number;
  data: string;
}

// 由边缘查询 Cloudflare 解析器，避开访客本地解析器和污染；结果允许浏览器缓存 5 分钟。
export async function handleDns(
  url: URL,
  headers: Record<string, string>,
): Promise<Response> {
  const name = (url.searchParams.get("name") ?? "").toLowerCase();

  if (!HOSTNAME_PATTERN.test(name)) {
    return errorResponse(
      "invalid_name",
      "Query parameter name must be a valid hostname.",
      400,
      headers,
    );
  }

  let answers: DnsAnswer[];

  try {
    const response = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${name}&type=A`,
      {
        headers: { Accept: "application/dns-json" },
        signal: AbortSignal.timeout(3000),
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    answers = ((await response.json()) as { Answer?: DnsAnswer[] }).Answer ?? [];
  } catch {
    return errorResponse("dns_failed", "DNS lookup failed.", 502, headers);
  }

  const pick = (type: number) => [
    ...new Set(
      answers
        .filter((answer) => answer.type === type)
        .map((answer) => answer.data.replace(/\.$/, "")),
    ),
  ];

  return new Response(JSON.stringify({ cnames: pick(5), ips: pick(1) }), {
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
