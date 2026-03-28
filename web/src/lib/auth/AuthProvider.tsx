"use client";

/**
 * lib/auth/AuthProvider.tsx — Auth context provider
 *
 * Provides { user, token, isLoading, signOut } to the entire portal subtree.
 *
 * Token source (in priority order):
 *   1. cbam_token cookie (set by login page)
 *   2. localStorage "cbam_token" (dev fallback)
 *
 * Expiry: checks JWT exp claim every 60 s. Signs out automatically on expiry.
 *
 * 401 handling: listens for the "cbam:unauthorized" CustomEvent dispatched by
 * the API client and calls signOut() so no API module needs to import the router.
 *
 * SSR: returns isLoading=true / user=null on server; hydrates on client mount.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { decodeJwt }  from "jose";
import type { User }   from "@/lib/api/types";

/* ── Context shape ────────────────────────────────────────────────────────────── */

interface AuthContextValue {
  user:      User | null;
  token:     string | null;
  isLoading: boolean;
  signOut:   () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/* ── Token helpers ────────────────────────────────────────────────────────────── */

function readToken(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)cbam_token=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  try { return localStorage.getItem("cbam_token"); } catch { return null; }
}

function clearPersistedToken(): void {
  // Expire cookie
  document.cookie = "cbam_token=; path=/; max-age=0";
  try { localStorage.removeItem("cbam_token"); } catch { /* ignore */ }
}

function decodeUser(token: string): User | null {
  try {
    const p = decodeJwt(token);
    return {
      sub:       p.sub       as string,
      tenant_id: p.tenant_id as string,
      scopes:    (p.scopes   as string[]) ?? [],
      name:      p.name      as string | undefined,
      exp:       p.exp       as number,
    };
  } catch {
    return null;
  }
}

function isExpired(user: User): boolean {
  return Date.now() / 1000 > user.exp;
}

/* ── Provider ─────────────────────────────────────────────────────────────────── */

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [token, setToken]     = useState<string | null>(null);
  const [user,  setUser]      = useState<User   | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /* signOut: clear state + storage + cookie, then redirect */
  const signOut = useCallback(() => {
    clearPersistedToken();
    setToken(null);
    setUser(null);
    router.replace("/login");
  }, [router]);

  /* Initialise on mount (client only) */
  useEffect(() => {
    const t = readToken();
    if (!t) {
      setIsLoading(false);
      // "/" is a public dual-state page — render scope checker without redirecting
      if (window.location.pathname !== "/") router.replace("/login");
      return;
    }

    const u = decodeUser(t);
    if (!u || isExpired(u)) {
      clearPersistedToken();
      setIsLoading(false);
      router.replace("/login");
      return;
    }

    setToken(t);
    setUser(u);
    setIsLoading(false);
  }, [router]);

  /* Poll expiry every 60 s */
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    const id = setInterval(() => {
      if (userRef.current && isExpired(userRef.current)) signOut();
    }, 60_000);
    return () => clearInterval(id);
  }, [signOut]);

  /* Listen for 401 signals from the API client */
  useEffect(() => {
    window.addEventListener("cbam:unauthorized", signOut);
    return () => window.removeEventListener("cbam:unauthorized", signOut);
  }, [signOut]);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

/* ── Consumer hook ────────────────────────────────────────────────────────────── */

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuthContext must be used inside <AuthProvider>");
  }
  return ctx;
}
