/**
 * lib/api/client.ts — Base HTTP client
 *
 * - Attaches Authorization: Bearer <token> from cookie (cbam_token) / localStorage
 * - Converts all HTTP errors to ApiError with plain-English user-facing messages
 * - On 401: dispatches "cbam:unauthorized" → AuthProvider signs the user out
 * - Exposes ledgerFetch / narrativeFetch typed helpers and xhrUpload for progress
 */

import type { ApiErrorShape } from "./types";

/* ── API base URLs ─────────────────────────────────────────────────────────────
 * Proxied through Next.js rewrites — no CORS in the browser.
 * Server-side env vars (LEDGER_URL / NARRATIVE_URL) are used only by
 * the rewrite destination in next.config.ts.                                   */
export const LEDGER_BASE    = "/api-proxy/ledger";
export const NARRATIVE_BASE = "/api-proxy/narrative";

/* ── Plain-English error catalogue ────────────────────────────────────────────── */
const USER_MESSAGE: Record<number, string> = {
  400: "The request contains invalid data. Please check your input and try again.",
  401: "Your session has expired. Please sign in again.",
  403: "You don't have permission to perform this action.",
  404: "The requested record could not be found.",
  409: "This action conflicts with existing data. Please refresh and try again.",
  422: "Some required information is missing or in the wrong format.",
  429: "Too many requests — please wait a moment and try again.",
  500: "An unexpected server error occurred. Please try again shortly.",
  502: "The server is temporarily unavailable. Please try again.",
  503: "The service is currently down for maintenance. Please try again later.",
};

const ERROR_CODE: Record<number, string> = {
  400: "BAD_REQUEST",   401: "UNAUTHORIZED",  403: "FORBIDDEN",
  404: "NOT_FOUND",     409: "CONFLICT",       422: "UNPROCESSABLE",
  429: "RATE_LIMITED",  500: "SERVER_ERROR",   502: "BAD_GATEWAY",
  503: "UNAVAILABLE",
};

/* ── ApiError ─────────────────────────────────────────────────────────────────── */

export class ApiError extends Error implements ApiErrorShape {
  readonly status:  number;
  readonly message: string;
  readonly code:    string;

  constructor(status: number, message?: string, code?: string) {
    const msg = message ?? USER_MESSAGE[status] ?? `Unexpected error (${status}).`;
    super(msg);
    this.name    = "ApiError";
    this.status  = status;
    this.message = msg;
    this.code    = code ?? ERROR_CODE[status] ?? "UNKNOWN_ERROR";
  }
}

/* ── Token ─────────────────────────────────────────────────────────────────────
 * Cookie takes precedence (login page sets document.cookie).
 * Falls back to localStorage for development builds.                           */
function getToken(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)cbam_token=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  try { return localStorage.getItem("cbam_token"); } catch { return null; }
}

function dispatchUnauthorized(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("cbam:unauthorized"));
  }
}

/* ── Core fetch ────────────────────────────────────────────────────────────────── */

export async function apiFetch<T>(
  url:  string,
  init: RequestInit = {}
): Promise<T> {
  const token = getToken();
  let res: Response;

  try {
    res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(
      0,
      "Unable to reach the server. Please check your internet connection.",
      "NETWORK_ERROR"
    );
  }

  if (res.status === 401) { dispatchUnauthorized(); throw new ApiError(401); }
  if (!res.ok)             throw new ApiError(res.status);
  if (res.status === 204)  return undefined as T;

  return res.json() as Promise<T>;
}

/* ── Service helpers ───────────────────────────────────────────────────────────── */

export function ledgerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return apiFetch<T>(`${LEDGER_BASE}${path}`, init);
}

export function narrativeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return apiFetch<T>(`${NARRATIVE_BASE}${path}`, init);
}

/* ── Multipart (file uploads — browser must set Content-Type with boundary) ───── */

export async function multipartFetch<T>(url: string, body: FormData): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(url, {
      method:  "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
    });
  } catch {
    throw new ApiError(
      0,
      "Unable to reach the server. Please check your internet connection.",
      "NETWORK_ERROR"
    );
  }
  if (res.status === 401) { dispatchUnauthorized(); throw new ApiError(401); }
  if (!res.ok)             throw new ApiError(res.status);
  return res.json() as Promise<T>;
}

/* ── XHR upload with progress ─────────────────────────────────────────────────── *
 * fetch() does not expose upload progress. XHR does.                            */

export function xhrUpload<T>(
  url:        string,
  body:       FormData,
  onProgress: (pct: number) => void,
  timeoutMs = 120_000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const xhr   = new XMLHttpRequest();

    xhr.open("POST", url);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.timeout = timeoutMs;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status === 401) { dispatchUnauthorized(); reject(new ApiError(401)); return; }
      if (xhr.status < 200 || xhr.status >= 300) {
        console.error(`[xhrUpload] ${xhr.status} from server:`, xhr.responseText);
        reject(new ApiError(xhr.status));
        return;
      }
      try { resolve(JSON.parse(xhr.responseText) as T); }
      catch { reject(new ApiError(500, "The server returned an unexpected response.")); }
    };

    xhr.onerror = () =>
      reject(new ApiError(0, "Upload failed. Please check your connection.", "NETWORK_ERROR"));

    xhr.ontimeout = () =>
      reject(new ApiError(408, "Processing timed out. Please try again.", "TIMEOUT"));

    xhr.send(body);
  });
}
