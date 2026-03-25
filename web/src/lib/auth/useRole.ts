"use client";

import { useAuthContext } from "./AuthProvider";

/**
 * User role — derived from JWT scopes.
 *
 * Admin   = has cbam:write (can upload, approve, flag for review)
 * Viewer  = read-only (sees all data, cannot mutate)
 *
 * Role is stored in cbam_registrations.user_role; the JWT carries it in scopes.
 * Default: viewer (fail-safe — never grant elevated access by accident).
 */
export type UserRole = "admin" | "viewer";

export function useRole(): UserRole {
  const { user } = useAuthContext();
  if (user?.scopes.includes("cbam:write")) return "admin";
  return "viewer";
}
