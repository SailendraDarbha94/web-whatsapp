"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/firebaseConfig";
import { useToast } from "@/contexts/toast-context";

type SendMode = "text" | "template";

export default function AdminDashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [ready, setReady] = useState(false);
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sendMode, setSendMode] = useState<SendMode>("template");
  const [templateName, setTemplateName] = useState("hello_world");
  const [templateLanguage, setTemplateLanguage] = useState("en_US");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let auth;
    try {
      auth = getFirebaseAuth();
    } catch {
      router.replace("/admin/login");
      return;
    }

    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/admin/login");
        return;
      }
      setReady(true);
    });

    return () => unsub();
  }, [router]);

  async function handleSignOut() {
    try {
      const auth = getFirebaseAuth();
      await signOut(auth);
      toast("Signed out.", "success");
      router.replace("/admin/login");
    } catch {
      toast("Could not sign out. Try again.", "error");
    }
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const auth = getFirebaseAuth();
    const user = auth.currentUser;
    if (!user) {
      toast("You are not signed in.", "error");
      return;
    }

    setSending(true);
    try {
      const idToken = await user.getIdToken(true);
      const body =
        sendMode === "text"
          ? {
              to: phone,
              mode: "text" as const,
              message,
            }
          : {
              to: phone,
              mode: "template" as const,
              templateName: templateName.trim() || "hello_world",
              templateLanguage: templateLanguage.trim() || "en_US",
            };

      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(body),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };

      if (!res.ok) {
        toast(data.error ?? "Could not send message.", "error");
        return;
      }

      toast("Message sent.", "success");
      if (sendMode === "text") {
        setMessage("");
      }
    } catch {
      toast("Network error. Try again.", "error");
    } finally {
      setSending(false);
    }
  }

  if (!ready) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col font-sans">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.08] px-6 py-4 dark:border-white/[0.12]">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            Admin
          </p>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Send WhatsApp
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Link
            href="/"
            className="rounded-full px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            Home
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-full border border-black/[0.08] bg-transparent px-4 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 dark:border-white/[0.12] dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-6 py-10">
        <p className="mb-8 text-sm text-zinc-600 dark:text-zinc-400">
          <strong className="font-medium text-zinc-800 dark:text-zinc-200">
            Template
          </strong>{" "}
          — for cold outreach using approved templates.{" "}
          <strong className="font-medium text-zinc-800 dark:text-zinc-200">
            Free-form text
          </strong>{" "}
          — only inside Meta&apos;s messaging window (e.g. after the user
          messaged you).
        </p>

        <form
          onSubmit={handleSend}
          className="flex flex-col gap-6 rounded-2xl border border-black/[0.08] bg-white p-6 shadow-sm dark:border-white/[0.12] dark:bg-zinc-950"
        >
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Message type
            </legend>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="sendMode"
                  checked={sendMode === "template"}
                  onChange={() => setSendMode("template")}
                  className="border-zinc-300 text-zinc-900 focus:ring-zinc-400"
                />
                Template
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="sendMode"
                  checked={sendMode === "text"}
                  onChange={() => setSendMode("text")}
                  className="border-zinc-300 text-zinc-900 focus:ring-zinc-400"
                />
                Free-form text
              </label>
            </div>
          </fieldset>

          <label className="flex flex-col gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Recipient phone number
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+1 555 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              disabled={sending}
              className="rounded-xl border border-zinc-300 bg-transparent px-3 py-2.5 text-[15px] font-normal outline-none ring-zinc-400 placeholder:text-zinc-400 focus:ring-2 disabled:opacity-60 dark:border-zinc-600"
            />
            <span className="text-xs font-normal text-zinc-500 dark:text-zinc-500">
              Include country code (digits only are sent to WhatsApp).
            </span>
          </label>

          {sendMode === "template" ? (
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Template name
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  disabled={sending}
                  placeholder="hello_world"
                  className="rounded-xl border border-zinc-300 bg-transparent px-3 py-2.5 text-[15px] font-normal outline-none ring-zinc-400 focus:ring-2 disabled:opacity-60 dark:border-zinc-600"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Language code
                <input
                  type="text"
                  value={templateLanguage}
                  onChange={(e) => setTemplateLanguage(e.target.value)}
                  disabled={sending}
                  placeholder="en_US"
                  className="rounded-xl border border-zinc-300 bg-transparent px-3 py-2.5 text-[15px] font-normal outline-none ring-zinc-400 focus:ring-2 disabled:opacity-60 dark:border-zinc-600"
                />
              </label>
            </div>
          ) : (
            <label className="flex flex-col gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Message
              <textarea
                rows={5}
                required
                placeholder="Type the message to send…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={sending}
                className="resize-y rounded-xl border border-zinc-300 bg-transparent px-3 py-2.5 text-[15px] font-normal leading-relaxed outline-none ring-zinc-400 placeholder:text-zinc-400 focus:ring-2 disabled:opacity-60 dark:border-zinc-600"
              />
            </label>
          )}

          <button
            type="submit"
            disabled={sending}
            className="mt-1 flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send message"}
          </button>
        </form>
      </main>
    </div>
  );
}
