import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { pkceChallenge, sign, verify, type OAuthOptions } from "../src/http/oauth.js";
import { TOKEN, USER, makeDeps } from "./helpers.js";

const SECRET = "test-signing-secret";
const REDIRECT = "https://pitangui.amazon.com/api/skill/link/TEST";
const oauth: OAuthOptions = {
  signingSecret: SECRET,
  clients: [{ id: "alexa-plus", secret: "s3cret", redirectPrefixes: ["https://pitangui.amazon.com/"] }],
  serviceUserToken: TOKEN,
};

let server: Server;
let base: string;

beforeAll(async () => {
  const deps = makeDeps();
  await deps.store.putUser(USER, TOKEN);
  const app = createApp(deps, { oauth });
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server?.close(r));
});

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const basic = "Basic " + Buffer.from("alexa-plus:s3cret").toString("base64");

async function authorize(verifier: string, accessCode = TOKEN): Promise<Response> {
  return fetch(`${base}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({
      response_type: "code",
      client_id: "alexa-plus",
      redirect_uri: REDIRECT,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      state: "xyz",
      resource: `${base}/mcp`,
      access_code: accessCode,
    }),
  });
}

describe("signed tokens", () => {
  it("round-trips and rejects tampering, wrong type and expiry", () => {
    const t = sign(SECRET, { typ: "access", sub: "u1", cid: "c", exp: Math.floor(Date.now() / 1000) + 60 });
    expect(verify(SECRET, t, "access")?.sub).toBe("u1");
    expect(verify(SECRET, t, "refresh")).toBeUndefined();
    expect(verify("other", t, "access")).toBeUndefined();
    expect(verify(SECRET, t.replace(/.$/, (c) => (c === "A" ? "B" : "A")), "access")).toBeUndefined();
    expect(verify(SECRET, t, "access", Date.now() + 120_000)).toBeUndefined();
  });
});

describe("OAuth 2.1 account linking", () => {
  it("publishes protected resource and authorization server metadata", async () => {
    const prm = (await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json()) as Record<string, unknown>;
    expect(prm).toMatchObject({ resource: `${base}/mcp`, authorization_servers: [base] });
    const as = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.token_endpoint).toBe(`${base}/oauth/token`);
  });

  it("returns 401 without a WWW-Authenticate header", async () => {
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("shows a link page and rejects unknown redirect URIs", async () => {
    const ok = await fetch(`${base}/oauth/authorize?response_type=code&client_id=alexa-plus&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=abc&code_challenge_method=S256`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("Link Macro Coach");
    const bad = await fetch(`${base}/oauth/authorize?response_type=code&client_id=alexa-plus&redirect_uri=https://evil.example/cb&code_challenge=abc&code_challenge_method=S256`);
    expect(bad.status).toBe(400);
  });

  it("rejects a wrong access code", async () => {
    const res = await authorize("v".repeat(43), "nope");
    expect(res.status).toBe(401);
  });

  it("completes code + PKCE, then calls MCP tools with the issued token", async () => {
    const verifier = "a-very-long-random-code-verifier-0123456789abcdef";
    const res = await authorize(verifier);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get("state")).toBe("xyz");
    const code = loc.searchParams.get("code")!;

    const wrong = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: basic },
      body: form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: "wrong" }),
    });
    expect(wrong.status).toBe(400);

    const tokenRes = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: basic },
      body: form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: verifier, resource: `${base}/mcp` }),
    });
    expect(tokenRes.status).toBe(200);
    const tokens = (await tokenRes.json()) as { access_token: string; refresh_token: string; token_type: string };
    expect(tokens.token_type).toBe("Bearer");

    const client = new Client({ name: "oauth-test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }));
    const r = (await client.callTool({ name: "get_daily_summary", arguments: {} })) as { isError?: boolean };
    expect(r.isError).toBeFalsy();
    await client.close();

    const refreshed = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: "alexa-plus", client_secret: "s3cret" }),
    });
    expect(refreshed.status).toBe(200);
  });

  it("supports client credentials for service-level calls and rejects bad secrets", async () => {
    const ok = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: basic },
      body: form({ grant_type: "client_credentials" }),
    });
    expect(ok.status).toBe(200);
    const bad = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ grant_type: "client_credentials", client_id: "alexa-plus", client_secret: "nope" }),
    });
    expect(bad.status).toBe(401);
  });
});
