import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";
import worker from "../dist/index.js";

const BASE = "https://ip.lucas04.top";
const BLOG = "https://blog.lucas04.top";
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function call(path, { cf = {}, method = "GET", headers = {} } = {}) {
  const request = new Request(BASE + path, { method, headers });
  Object.defineProperty(request, "cf", { value: cf });
  return worker.fetch(request);
}

function stubDoh(answer) {
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return Response.json({ Answer: answer });
  };
  return asked;
}

const CF = {
  country: "DK",
  city: "Copenhagen",
  region: "Capital Region",
  latitude: "55.67",
  longitude: "12.56",
  asn: 3292,
  asOrganization: "TDC",
  colo: "CPH",
  httpProtocol: "HTTP/2",
  tlsVersion: "TLSv1.3",
};

test("根路径保持博客依赖的结构", async () => {
  const response = await call("/?headers=0", {
    cf: CF,
    headers: { "CF-Connecting-IP": "2001:db8::1", Origin: BLOG },
  });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), BLOG);
  assert.deepEqual(data.ip, {
    address: "2001:db8::1",
    version: 6,
    source: "CF-Connecting-IP",
  });
  assert.equal(data.geo.countryCode, "DK");
  assert.equal(data.geo.coordinates.latitude, 55.67);
  assert.equal(data.network.asOrganization, "TDC");
  assert.equal(data.edge.colo, "CPH");
  assert.equal(data.headers, undefined);
  assert.equal(data.api.cache, "no-store");
});

test("根路径脱敏敏感请求头", async () => {
  const data = await (
    await call("/", { headers: { Authorization: "secret", "X-Api-Key": "k" } })
  ).json();

  assert.equal(data.headers.values.authorization, "[REDACTED]");
  assert.deepEqual(data.headers.redacted.sort(), ["authorization", "x-api-key"]);
});

test("未知路径返回 404，不再落到根路径的数据", async () => {
  const response = await call("/nope", { headers: { Origin: BLOG } });

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "not_found");
});

test("/v1/me 返回工具需要的连接信息", async () => {
  const response = await call("/v1/me", {
    cf: CF,
    headers: { "CF-Connecting-IP": "203.0.113.9", Origin: BLOG },
  });

  assert.deepEqual(await response.json(), {
    ip: "203.0.113.9",
    version: 4,
    country: "DK",
    region: "Capital Region",
    city: "Copenhagen",
    lat: 55.67,
    lon: 12.56,
    asn: 3292,
    org: "TDC",
    colo: "CPH",
    http: "HTTP/2",
  });
  assert.equal(response.headers.get("Timing-Allow-Origin"), BLOG);
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
});

test("其他来源读不到 CORS 响应", async () => {
  const response = await call("/v1/me", {
    headers: { Origin: "https://evil.example" },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(response.headers.get("Timing-Allow-Origin"), null);
});

test("/v1/whoami 去掉 cookie 与 CF 头并查询 PTR", async () => {
  const asked = stubDoh([{ type: 12, data: "host.example.net." }]);
  const data = await (
    await call("/v1/whoami", {
      cf: { ...CF, ignored: "x" },
      headers: {
        "CF-Connecting-IP": "203.0.113.9",
        Cookie: "a=b",
        "CF-Ray": "abc",
        "User-Agent": "test-ua",
      },
    })
  ).json();

  assert.equal(data.ip, "203.0.113.9");
  assert.equal(data.v, 4);
  assert.equal(data.ptr, "host.example.net");
  assert.equal(data.cf.country, "DK");
  assert.equal(data.cf.ignored, undefined);
  assert.equal(data.h["user-agent"], "test-ua");
  assert.equal(data.h.cookie, undefined);
  assert.equal(data.h["cf-ray"], undefined);
  assert.equal(typeof data.at, "number");
  assert.match(asked[0], /name=9\.113\.0\.203\.in-addr\.arpa&type=PTR/);
});

test("/v1/whoami 展开压缩的 IPv6 反向域名", async () => {
  const asked = stubDoh([]);
  const data = await (
    await call("/v1/whoami", { headers: { "CF-Connecting-IP": "2001:db8::1" } })
  ).json();

  assert.equal(data.v, 6);
  assert.equal(data.ptr, null);
  assert.ok(
    asked[0].includes(
      `name=${"20010db8000000000000000000000001".split("").reverse().join(".")}.ip6.arpa`,
    ),
  );
});

test("/v1/whoami 在 PTR 查询失败时仍然返回", async () => {
  globalThis.fetch = async () => {
    throw new Error("down");
  };
  const response = await call("/v1/whoami", {
    headers: { "CF-Connecting-IP": "203.0.113.9" },
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).ptr, null);
});

test("/v1/dns 整理 CNAME 与 A 记录", async () => {
  stubDoh([
    { type: 5, data: "cdn.example.net." },
    { type: 5, data: "cdn.example.net." },
    { type: 1, data: "192.0.2.1" },
    { type: 1, data: "192.0.2.2" },
  ]);
  const response = await call("/v1/dns?name=WWW.Example.com", {
    headers: { Origin: BLOG },
  });

  assert.deepEqual(await response.json(), {
    cnames: ["cdn.example.net"],
    ips: ["192.0.2.1", "192.0.2.2"],
  });
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=300");
});

test("/v1/dns 校验域名并处理上游失败", async () => {
  const headers = { Origin: BLOG };

  for (const name of ["", "localhost", "a b.com", "1.2.3.4", "x.com&type=TXT"]) {
    const response = await call(`/v1/dns?name=${encodeURIComponent(name)}`, { headers });
    assert.equal(response.status, 400, name);
  }

  globalThis.fetch = async () => new Response("no", { status: 500 });
  assert.equal((await call("/v1/dns?name=example.com", { headers })).status, 502);
});

test("/v1/dns 拒绝非博客来源", async () => {
  const path = "/v1/dns?name=example.com";

  assert.equal((await call(path)).status, 403);
  assert.equal(
    (await call(path, { headers: { Origin: "https://evil.example" } })).status,
    403,
  );
});

test("测速接口已移除", async () => {
  const headers = { Origin: BLOG };

  assert.equal((await call("/v1/speed/down?bytes=10", { headers })).status, 404);
  assert.equal((await call("/v1/speed/up", { method: "POST", headers })).status, 404);
});

test("预检只允许 GET，其他方法返回 405", async () => {
  const preflight = await call("/v1/me", {
    method: "OPTIONS",
    headers: { Origin: BLOG },
  });

  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");

  const wrong = await call("/v1/me", { method: "POST", headers: { Origin: BLOG } });
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get("Allow"), "GET, OPTIONS");
});

test("跳转链最后一跳只去白名单内的域名", async () => {
  const allowed = await call("/v1/hop/1/www.netflix.com/jp/?a=1");
  assert.equal(allowed.status, 302);
  assert.equal(allowed.headers.get("Location"), "https://www.netflix.com/jp/?a=1");

  const self = await call("/v1/hop/1/ip.lucas04.top/v1/hop.txt");
  assert.equal(self.headers.get("Location"), "https://ip.lucas04.top/v1/hop.txt");

  const bare = await call("/v1/hop/1/www.disneyplus.com");
  assert.equal(bare.headers.get("Location"), "https://www.disneyplus.com/");

  for (const path of [
    "/v1/hop/1/evil.example/",
    "/v1/hop/1/www.netflix.com@evil.example/",
    "/v1/hop/1/www.netflix.com.evil.example/",
    "/v1/hop/1/www.netflix.com:8443/",
  ]) {
    assert.equal((await call(path)).status, 403, path);
  }

  assert.equal((await call("/v1/hop/0/www.netflix.com/")).status, 404);
  assert.equal((await call("/v1/hop/1/")).status, 404);
  assert.equal((await call("/v1/hop/1/www.netflix.com/", { method: "POST" })).status, 405);
});

test("_redirects 从 25 连续跳到 1，并附带探测目标文件", async () => {
  const rules = (await readFile(new URL("../public/_redirects", import.meta.url), "utf8"))
    .trim()
    .split("\n");

  assert.equal(rules.length, 24);
  rules.forEach((rule, index) => {
    const n = 25 - index;
    assert.equal(rule, `/v1/hop/${n}/* /v1/hop/${n - 1}/:splat 302`);
  });
  assert.equal(
    await readFile(new URL("../public/v1/hop.txt", import.meta.url), "utf8"),
    "ok\n",
  );
});
