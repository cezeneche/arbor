import { decodeJwt } from "jose";
import type { AuthContext } from "./types";

const TOKEN_KEY = "cbam_token";

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function getRawToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getAuthContext(): AuthContext | null {
  const token = getRawToken();
  if (!token) return null;
  try {
    const payload = decodeJwt(token);
    const ctx: AuthContext = {
      sub: payload.sub as string,
      tenant_id: payload.tenant_id as string,
      scopes: (payload.scopes as string[]) ?? [],
      roles: (payload.roles as string[]) ?? [],
      exp: payload.exp as number,
      jti: payload.jti as string | undefined,
    };
    // Check expiry
    if (ctx.exp && Date.now() / 1000 > ctx.exp) {
      clearToken();
      return null;
    }
    return ctx;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return getAuthContext() !== null;
}

export function hasScope(scope: string): boolean {
  return getAuthContext()?.scopes.includes(scope) ?? false;
}

export function isReviewer(): boolean {
  return hasScope("review:write");
}
