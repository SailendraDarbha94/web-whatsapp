import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth } from "@/lib/firebase/admin";
import { OPERATOR_CLAIM } from "@/lib/firebase/operator-claim";

export type OperatorAuthResult =
  | { ok: true; uid: string }
  | { ok: false; status: 401 | 403 | 500; error: string };

/**
 * Check that a request comes from an inbox operator: a valid, unrevoked
 * Firebase ID token (`Authorization: Bearer …`) for an enabled account that
 * carries the operator claim. Being signed in isn't enough: anyone can create
 * an account in a Firebase project from its public web config unless sign-up
 * is turned off.
 */
export async function authorizeOperator(request: Request): Promise<OperatorAuthResult> {
  const idToken = bearerToken(request.headers.get("authorization"));
  if (!idToken) {
    return { ok: false, status: 401, error: "Missing or invalid Authorization header." };
  }

  let token: DecodedIdToken;
  try {
    // checkRevoked: disabling an account or revoking its sessions applies at once.
    token = await getAdminAuth().verifyIdToken(idToken, true);
  } catch (e) {
    return tokenFailure(e);
  }

  if (token[OPERATOR_CLAIM] !== true) {
    return {
      ok: false,
      status: 403,
      error:
        "This account doesn't have operator access. Ask the project owner to grant it, then sign in again.",
    };
  }
  return { ok: true, uid: token.uid };
}

function tokenFailure(e: unknown): OperatorAuthResult {
  const { code, message } = errorInfo(e);
  const dev = process.env.NODE_ENV === "development";

  if (
    message.includes("Firebase Admin env not loaded") ||
    message.includes("FIREBASE_ADMIN_CREDENTIALS_INVALID")
  ) {
    console.error("[auth] Firebase Admin is not configured:", message);
    return {
      ok: false,
      status: 500,
      error: dev ? message : "The server's Firebase Admin credentials are missing or invalid.",
    };
  }

  switch (code) {
    case "auth/id-token-revoked":
      return { ok: false, status: 401, error: "Your session was signed out. Sign in again." };
    case "auth/user-disabled":
      return { ok: false, status: 403, error: "This account has been disabled." };
    case "auth/user-not-found":
      return { ok: false, status: 401, error: "This account no longer exists." };
  }

  console.warn("[auth] ID token rejected:", code ?? "", message);
  const audienceMismatch = /\baud(ience)?\b/i.test(message);
  const hint = dev ? ` (${code ? `${code}: ` : ""}${message})` : "";
  return {
    ok: false,
    status: 401,
    error:
      (audienceMismatch
        ? "Firebase project mismatch: the browser config and FIREBASE_ADMIN_PROJECT_ID must name the same project."
        : "Invalid or expired session. Sign out and sign in again.") + hint,
  };
}

function bearerToken(header: string | null): string | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length ? token : null;
}

function errorInfo(e: unknown): { code?: string; message: string } {
  if (typeof e === "object" && e !== null) {
    const o = e as { code?: unknown; message?: unknown };
    return {
      code: typeof o.code === "string" ? o.code : undefined,
      message: typeof o.message === "string" ? o.message : String(e),
    };
  }
  return { message: String(e) };
}
