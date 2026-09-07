import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import type { AgentContext } from "@cinememory/core";
import type { Context, Next } from "hono";

/**
 * Accounts for the family app: local email + password (scrypt) and Google sign-in (ID token verified server-side).
 * Sessions are bearer tokens stored in the document store. Deliberately simple; the studio routes stay open for the demo.
 */
export interface Account {
  id: string;
  email: string;
  name: string;
  provider: "local" | "google";
  passwordHash?: string;
  googleSub?: string;
  createdAt: string;
}
interface Session {
  token: string;
  accountId: string;
  createdAt: string;
  expiresAt: string;
}

const SCOPE = "_accounts";
const SESSION_DAYS = 30;

function hash(password: string, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
function verify(password: string, stored: string) {
  const [salt, h] = stored.split(":");
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(h, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export class AuthService {
  private google?: OAuth2Client;
  constructor(
    private ctx: AgentContext,
    readonly googleClientId?: string,
  ) {
    if (googleClientId) this.google = new OAuth2Client(googleClientId);
  }

  private byEmail(email: string): Account | undefined {
    return this.ctx.repo.store.list<Account>("accounts", SCOPE).find((a) => a.email.toLowerCase() === email.toLowerCase());
  }
  get(id: string): Account | undefined {
    return this.ctx.repo.store.get<Account>("accounts", SCOPE, id);
  }
  private save(a: Account) {
    this.ctx.repo.store.put("accounts", SCOPE, a.id, a);
  }
  private issue(accountId: string): Session {
    const s: Session = { token: randomBytes(32).toString("hex"), accountId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString() };
    this.ctx.repo.store.put("sessions", SCOPE, s.token, s);
    return s;
  }

  register(email: string, password: string, name: string): { account: Account; token: string } {
    if (this.byEmail(email)) throw new AuthError("An account with this email already exists");
    if (password.length < 8) throw new AuthError("Password must be at least 8 characters");
    const account: Account = { id: `acc_${randomBytes(6).toString("hex")}`, email: email.trim(), name: name.trim() || email.split("@")[0], provider: "local", passwordHash: hash(password), createdAt: new Date().toISOString() };
    this.save(account);
    return { account, token: this.issue(account.id).token };
  }

  login(email: string, password: string): { account: Account; token: string } {
    const account = this.byEmail(email);
    if (!account || !account.passwordHash || !verify(password, account.passwordHash)) throw new AuthError("Email or password is not right");
    return { account, token: this.issue(account.id).token };
  }

  async loginWithGoogle(credential: string): Promise<{ account: Account; token: string }> {
    if (!this.google) throw new AuthError("Google sign-in is not configured (set GOOGLE_OAUTH_CLIENT_ID)");
    const ticket = await this.google.verifyIdToken({ idToken: credential, audience: this.googleClientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) throw new AuthError("Google did not return an email");
    let account = this.ctx.repo.store.list<Account>("accounts", SCOPE).find((a) => a.googleSub === payload.sub) ?? this.byEmail(payload.email);
    if (!account) {
      account = { id: `acc_${randomBytes(6).toString("hex")}`, email: payload.email, name: payload.name ?? payload.email.split("@")[0], provider: "google", googleSub: payload.sub, createdAt: new Date().toISOString() };
      this.save(account);
    } else if (!account.googleSub) {
      account = { ...account, googleSub: payload.sub };
      this.save(account);
    }
    return { account, token: this.issue(account.id).token };
  }

  logout(token: string) {
    this.ctx.repo.store.delete("sessions", SCOPE, token);
  }

  /** Account for a bearer token, or undefined. */
  resolve(authorization?: string): Account | undefined {
    const token = authorization?.replace(/^Bearer\s+/i, "").trim();
    if (!token) return undefined;
    const s = this.ctx.repo.store.get<Session>("sessions", SCOPE, token);
    if (!s || s.expiresAt < new Date().toISOString()) return undefined;
    return this.get(s.accountId);
  }

  /** Hono middleware: attaches `account` to the context (undefined when anonymous). */
  middleware() {
    return async (c: Context, next: Next) => {
      c.set("account", this.resolve(c.req.header("authorization")));
      await next();
    };
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export const publicAccount = (a: Account) => ({ id: a.id, email: a.email, name: a.name, provider: a.provider });
