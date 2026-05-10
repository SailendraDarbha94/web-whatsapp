"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FirebaseError } from "firebase/app";
import { onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/firebaseConfig";
import { useToast } from "@/contexts/toast-context";

export default function AdminLoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [firebaseConfigError] = useState<string | null>(() => {
    try {
      getFirebaseAuth();
      return null;
    } catch {
      return "Firebase is not configured. Add NEXT_PUBLIC_FIREBASE_* keys to .env.local.";
    }
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(firebaseConfigError);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (firebaseConfigError) return;
    const auth = getFirebaseAuth();
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) router.replace("/admin/dashboard");
    });
    return () => unsub();
  }, [firebaseConfigError, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const auth = getFirebaseAuth();
      await signInWithEmailAndPassword(auth, email.trim(), password);
      toast("Signed in successfully.", "success");
      router.replace("/admin/dashboard");
    } catch (err) {
      if (err instanceof FirebaseError) {
        setError(formatAuthError(err));
      } else {
        setError("Something went wrong. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-black/[0.08] bg-white px-8 py-10 shadow-sm dark:border-white/[0.12] dark:bg-zinc-950">
        <Link
          href="/"
          className="mb-6 inline-flex text-sm font-medium text-zinc-600 underline-offset-4 transition hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← Back to home
        </Link>
        <h1 className="text-center text-xl font-semibold tracking-tight">
          Admin sign in
        </h1>
        <p className="mt-2 text-center text-sm text-zinc-600 dark:text-zinc-400">
          Use Firebase Authentication (email / password enabled in console).
        </p>
        <form className="mt-8 flex flex-col gap-4" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Email
            <input
              className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-[15px] outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-600"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Password
            <input
              className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-[15px] outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-600"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            className="mt-2 flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

function formatAuthError(error: FirebaseError): string {
  switch (error.code) {
    case "auth/invalid-email":
      return "That email doesn’t look valid.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    default:
      return error.message || "Sign-in failed.";
  }
}
