"use client";

/**
 * lib/auth/useAuth.ts — Auth hook for portal components
 *
 * Usage:
 *   const { user, token, isLoading, signOut, hasScope, isReviewer } = useAuth();
 *
 * Must be called inside a component wrapped by <AuthProvider>.
 */

import { useAuthContext } from "./AuthProvider";

export interface UseAuthReturn {
  /** Decoded JWT claims. Null while loading or unauthenticated. */
  user:            ReturnType<typeof useAuthContext>["user"];
  /** Raw JWT string. Null while loading or unauthenticated. */
  token:           string | null;
  /** True while the token is being read from storage on first mount. */
  isLoading:       boolean;
  /** Clears the token, cookie, and redirects to /login. */
  signOut:         () => void;
  /** Returns true if the decoded token contains the given scope string. */
  hasScope:        (scope: string) => boolean;
  /** Shorthand for hasScope("review:write"). */
  isReviewer:      boolean;
}

export function useAuth(): UseAuthReturn {
  const { user, token, isLoading, signOut } = useAuthContext();

  function hasScope(scope: string): boolean {
    return user?.scopes.includes(scope) ?? false;
  }

  return {
    user,
    token,
    isLoading,
    signOut,
    hasScope,
    isReviewer: hasScope("review:write"),
  };
}
