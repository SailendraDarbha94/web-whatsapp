"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/firebaseConfig";
import { useOperatorSession } from "@/lib/firebase/use-operator-session";

/**
 * Renders its children only for inbox operators. Signed-out visitors go to
 * the login page; signed-in accounts without operator access see why, with a
 * way to sign out and switch accounts.
 */
export function OperatorGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const session = useOperatorSession();
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (session.status === "signed-out") router.replace("/admin/login");
  }, [session.status, router]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut(getFirebaseAuth());
    } finally {
      setSigningOut(false);
    }
  }

  if (session.status === "operator") return <>{children}</>;

  if (session.status === "denied" || session.status === "error") {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm space-y-4 rounded-2xl border border-black/[0.08] bg-white px-8 py-10 text-center shadow-sm dark:border-white/[0.12] dark:bg-zinc-950">
          <h1 className="text-lg font-semibold tracking-tight">
            {session.status === "denied" ? "No inbox access" : "Something went wrong"}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {session.status === "denied" ? (
              <>
                {session.user.email ?? "This account"} isn&apos;t an inbox operator.
                Ask the project owner to grant access, then reload this page.
              </>
            ) : (
              session.message
            )}
          </p>
          {session.status === "denied" && (
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              className="inline-flex h-10 items-center justify-center rounded-full border border-black/[0.08] px-5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-white/[0.12] dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
    </div>
  );
}
