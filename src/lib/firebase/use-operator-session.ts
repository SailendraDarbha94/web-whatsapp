"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/firebaseConfig";
import { OPERATOR_CLAIM } from "@/lib/firebase/operator-claim";

export type OperatorSession =
  | { status: "loading" }
  | { status: "signed-out" }
  /** Signed in, but the account doesn't carry the operator claim. */
  | { status: "denied"; user: User }
  | { status: "operator"; user: User }
  | { status: "error"; message: string };

/**
 * The signed-in user and whether they may use the inbox. The token is
 * refreshed when the session starts, so a claim granted or removed since the
 * last sign-in applies straight away. Firestore and the API routes enforce
 * the same claim; this only decides what the page shows.
 */
export function useOperatorSession(): OperatorSession {
  const [configured] = useState(() => {
    try {
      getFirebaseAuth();
      return true;
    } catch {
      return false;
    }
  });
  const [session, setSession] = useState<OperatorSession>({ status: "loading" });

  useEffect(() => {
    if (!configured) return;
    let latest = 0;
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      const check = ++latest;
      if (!user) {
        setSession({ status: "signed-out" });
        return;
      }
      setSession({ status: "loading" });
      user.getIdTokenResult(true).then(
        (result) => {
          if (check !== latest) return;
          setSession(
            result.claims[OPERATOR_CLAIM] === true
              ? { status: "operator", user }
              : { status: "denied", user }
          );
        },
        () => {
          if (check !== latest) return;
          setSession({
            status: "error",
            message: "Couldn't check your access. Check your connection, then reload the page.",
          });
        }
      );
    });
    return () => {
      latest++;
      unsubscribe();
    };
  }, [configured]);

  // Without a Firebase config nobody can sign in; the login page explains why.
  return configured ? session : { status: "signed-out" };
}
