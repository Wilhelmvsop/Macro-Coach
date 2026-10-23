import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import type { User } from "../domain/types.js";
import { errorFields, log } from "../logger.js";
import type { Store } from "../ports.js";

/**
 * Minimal OAuth 2.1 authorization server for account linking, as required by
 * the Alexa+ MCP Toolkit: authorization code flow with PKCE (S256), refresh
 * tokens, client credentials, RFC 9728 protected resource metadata and RFC 8414
 * authorization server metadata.
 *
 * Codes and tokens are HMAC-signed and self-contained, so any Lambda instance
 * can verify them without shared session storage.
 */

export interface OAuthClient {
  id: string;
  /** Confidential clients have a secret; public clients rely on PKCE alone. */
  secret?: string;
  /** Allowed redirect URI prefixes. */
  redirectPrefixes: string[];
}

export interface OAuthOptions {
  signingSecret: string;
  clients: OAuthClient[];
  /** User that client-credentials (service-level) tokens act for. */
  serviceUserToken?: string;
}

const SCOPE = "nutrition";
const CODE_TTL_S = 600;
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 90 * 24 * 3600;
const PREFIX = "mc1.";

type Claims = { typ: "code" | "access" | "refresh"; sub: string; cid: string; exp: number; cc?: string; ru?: string; res?: string };

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function sign(secret: string, claims: Claims): string {
  const body = b64url(JSON.stringify(claims));
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${PREFIX}${body}.${mac}`;
}

export function verify(secret: string, token: string, typ: Claims["typ"], now = Date.now()): Claims | undefined {
  if (!token.startsWith(PREFIX)) return undefined;
  const [body, mac] = token.slice(PREFIX.length).split(".");
  if (!body || !mac) return undefined;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
    if (claims.typ !== typ || claims.exp * 1000 < now) return undefined;
    return claims;
  } catch {
    return undefined;
  }
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Resolves a bearer token: a signed OAuth access token, or a static per-user API key. */
export async function resolveBearer(store: Store, opts: OAuthOptions | undefined, token: string): Promise<User | undefined> {
  if (opts && token.startsWith(PREFIX)) {
    const claims = verify(opts.signingSecret, token, "access");
    return claims ? store.getUser(claims.sub) : undefined;
  }
  return store.getUserByToken(token);
}

function baseUrl(req: Request): string {
  const proto = (req.header("x-forwarded-proto") ?? req.protocol).split(",")[0]!.trim();
  return `${proto}://${req.header("x-forwarded-host") ?? req.header("host")}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function oauthError(res: Response, status: number, error: string, description: string): void {
  res.status(status).json({ error, error_description: description });
}

function linkPage(params: Record<string, string>, message?: string): string {
  const hidden = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link Macro Coach</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f14;color:#f4f7fb;font:18px/1.5 "Segoe UI",system-ui,sans-serif}
main{width:min(92vw,420px);background:#131a22;border:1px solid #2a3646;border-radius:16px;padding:28px}
h1{margin:0 0 8px;font-size:1.5rem}p{color:#a9b6c6;margin:0 0 18px}label{display:block;font-size:.9rem;margin-bottom:6px}
input[type=text]{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #2a3646;background:#0b0f14;color:#f4f7fb;font:inherit}
button{margin-top:16px;width:100%;padding:12px;border:0;border-radius:10px;background:#22c55e;color:#04210f;font:600 1rem system-ui;cursor:pointer}
.err{color:#f87171}</style></head><body><main><h1>Link Macro Coach</h1>
<p>Enter your Macro Coach access code to let your voice assistant log meals and read your nutrition progress. The demo code is <code>demo-judge-token</code>.</p>
${message ? `<p class="err" role="alert">${esc(message)}</p>` : ""}
<form method="post" action="/oauth/authorize">${hidden}<label for="code">Access code</label>
<input id="code" name="access_code" type="text" autocomplete="off" required autofocus><button type="submit">Link account</button></form></main></body></html>`;
}

const AUTH_PARAMS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"] as const;

export function mountOAuth(app: Express, store: Store, opts: OAuthOptions): void {
  const client = (id: string | undefined) => opts.clients.find((c) => c.id === id);
  const redirectAllowed = (c: OAuthClient, uri: string) => c.redirectPrefixes.some((p) => uri.startsWith(p));

  const prm = (req: Request, res: Response) => {
    const base = baseUrl(req);
    res.json({ resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ["header"], scopes_supported: [SCOPE], resource_name: "Macro Coach" });
  };
  app.get("/.well-known/oauth-protected-resource", prm);
  app.get("/.well-known/oauth-protected-resource/mcp", prm);

  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    const base = baseUrl(req);
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
      scopes_supported: [SCOPE],
    });
  });

  /** Validates an authorization request; returns an error message or the client. */
  const checkAuthRequest = (p: Record<string, string>): string | OAuthClient => {
    const c = client(p.client_id);
    if (!c) return "Unknown client.";
    if (!p.redirect_uri || !redirectAllowed(c, p.redirect_uri)) return "This redirect address is not allowed.";
    if (p.response_type !== "code") return "Only the authorization code flow is supported.";
    if (!p.code_challenge || p.code_challenge_method !== "S256") return "PKCE with S256 is required.";
    return c;
  };

  const pick = (src: Record<string, unknown>) =>
    Object.fromEntries(AUTH_PARAMS.filter((k) => typeof src[k] === "string").map((k) => [k, src[k] as string])) as Record<string, string>;

  app.get("/oauth/authorize", (req, res) => {
    const p = pick(req.query as Record<string, unknown>);
    const check = checkAuthRequest(p);
    if (typeof check === "string") {
      res.status(400).type("html").send(`<p>${esc(check)}</p>`);
      return;
    }
    res.type("html").send(linkPage(p));
  });

  app.post("/oauth/authorize", express.urlencoded({ extended: false }), async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const p = pick(body);
    const check = checkAuthRequest(p);
    if (typeof check === "string") {
      res.status(400).type("html").send(`<p>${esc(check)}</p>`);
      return;
    }
    const user = await store.getUserByToken(String(body.access_code ?? "").trim());
    if (!user) {
      res.status(401).type("html").send(linkPage(p, "That access code didn't match an account. Please try again."));
      return;
    }
    const code = sign(opts.signingSecret, {
      typ: "code",
      sub: user.id,
      cid: check.id,
      exp: Math.floor(Date.now() / 1000) + CODE_TTL_S,
      cc: p.code_challenge!,
      ru: p.redirect_uri!,
      ...(p.resource ? { res: p.resource } : {}),
    });
    const target = new URL(p.redirect_uri!);
    target.searchParams.set("code", code);
    if (p.state) target.searchParams.set("state", p.state);
    log.info("oauth.code.issued", { userId: user.id, clientId: check.id });
    res.redirect(302, target.toString());
  });

  app.post("/oauth/token", express.urlencoded({ extended: false }), async (req, res) => {
    try {
      const body = req.body as Record<string, string | undefined>;
      // Client authentication: HTTP Basic or form fields.
      let clientId = body.client_id;
      let clientSecret = body.client_secret;
      const basic = /^Basic\s+(.+)$/i.exec(req.header("authorization") ?? "")?.[1];
      if (basic) {
        const [id, secret] = Buffer.from(basic, "base64").toString("utf8").split(":");
        clientId = decodeURIComponent(id ?? "");
        clientSecret = decodeURIComponent(secret ?? "");
      }
      const c = client(clientId);
      if (!c) return oauthError(res, 401, "invalid_client", "Unknown client.");
      if (c.secret && clientSecret !== c.secret) return oauthError(res, 401, "invalid_client", "Client authentication failed.");

      const now = Math.floor(Date.now() / 1000);
      const issue = (sub: string) => ({
        access_token: sign(opts.signingSecret, { typ: "access", sub, cid: c.id, exp: now + ACCESS_TTL_S }),
        token_type: "Bearer",
        expires_in: ACCESS_TTL_S,
        refresh_token: sign(opts.signingSecret, { typ: "refresh", sub, cid: c.id, exp: now + REFRESH_TTL_S }),
        scope: SCOPE,
      });
      res.setHeader("Cache-Control", "no-store");

      if (body.grant_type === "authorization_code") {
        const claims = verify(opts.signingSecret, body.code ?? "", "code");
        if (!claims || claims.cid !== c.id) return oauthError(res, 400, "invalid_grant", "The authorization code is invalid or expired.");
        if (claims.ru !== body.redirect_uri) return oauthError(res, 400, "invalid_grant", "redirect_uri does not match.");
        if (!body.code_verifier || pkceChallenge(body.code_verifier) !== claims.cc) return oauthError(res, 400, "invalid_grant", "PKCE verification failed.");
        if (claims.res && body.resource && claims.res !== body.resource) return oauthError(res, 400, "invalid_target", "resource does not match.");
        log.info("oauth.token.issued", { grant: "authorization_code", userId: claims.sub, clientId: c.id });
        return res.json(issue(claims.sub));
      }
      if (body.grant_type === "refresh_token") {
        const claims = verify(opts.signingSecret, body.refresh_token ?? "", "refresh");
        if (!claims || claims.cid !== c.id) return oauthError(res, 400, "invalid_grant", "The refresh token is invalid or expired.");
        return res.json(issue(claims.sub));
      }
      if (body.grant_type === "client_credentials") {
        if (!c.secret) return oauthError(res, 400, "unauthorized_client", "Client credentials require a confidential client.");
        const user = opts.serviceUserToken ? await store.getUserByToken(opts.serviceUserToken) : undefined;
        if (!user) return oauthError(res, 400, "invalid_request", "No service account is configured.");
        // Client credentials get no refresh token (RFC 6749 section 4.4.3).
        const token: Partial<ReturnType<typeof issue>> = issue(user.id);
        delete token.refresh_token;
        return res.json(token);
      }
      return oauthError(res, 400, "unsupported_grant_type", "Unsupported grant_type.");
    } catch (err) {
      log.error("oauth.token.error", errorFields(err));
      return oauthError(res, 500, "server_error", "Something went wrong.");
    }
  });
}

/** Builds OAuth options from environment variables; returns undefined when OAuth is disabled. */
export function oauthFromEnv(env: NodeJS.ProcessEnv): OAuthOptions | undefined {
  const signingSecret = env.OAUTH_SIGNING_SECRET;
  if (!signingSecret) return undefined;
  const prefixes = (env.OAUTH_REDIRECT_PREFIXES ??
    "https://pitangui.amazon.com/,https://layla.amazon.com/,https://alexa.amazon.co.jp/,https://www.amazon.com/,http://localhost:,http://127.0.0.1:")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    signingSecret,
    clients: [
      {
        id: env.OAUTH_CLIENT_ID ?? "alexa-plus",
        ...(env.OAUTH_CLIENT_SECRET ? { secret: env.OAUTH_CLIENT_SECRET } : {}),
        redirectPrefixes: prefixes,
      },
    ],
    ...(env.DEMO_TOKEN ? { serviceUserToken: env.DEMO_TOKEN } : {}),
  };
}

export const newSecret = () => randomBytes(32).toString("base64url");
