"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import {
  getFirebaseAuth,
  getFirebaseFirestore,
} from "@/lib/firebase/firebaseConfig";
import { useToast } from "@/contexts/toast-context";

type Conversation = {
  waId: string;
  name?: string;
  lastMessageText?: string;
  lastDirection?: "in" | "out";
  lastMessageAt?: Timestamp;
  serviceWindowExpiresAt?: Timestamp;
  unreadCount?: number;
};

type Message = {
  id: string;
  direction: "in" | "out";
  type: string;
  text?: string | null;
  status?: string;
  errorTitle?: string;
  timestamp?: Timestamp;
};

function toMillis(ts?: Timestamp): number | undefined {
  try {
    return ts?.toMillis();
  } catch {
    return undefined;
  }
}

function formatTime(ts?: Timestamp): string {
  const ms = toMillis(ts);
  if (!ms) return "";
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

const STATUS_LABEL: Record<string, string> = {
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
};

export default function InboxPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [ready, setReady] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

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

  // Subscribe to the conversation list.
  useEffect(() => {
    if (!ready) return;
    const db = getFirebaseFirestore();
    const q = query(
      collection(db, "conversations"),
      orderBy("lastMessageAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setConversations(
          snap.docs.map((d) => ({ waId: d.id, ...(d.data() as object) }) as Conversation)
        );
      },
      (err) => {
        console.error("[inbox] conversations listener error:", err);
        toast("Could not load conversations. Check Firestore rules.", "error");
      }
    );
    return () => unsub();
  }, [ready, toast]);

  // Keep a clock ticking so the 24h reply window flips closed on its own,
  // without reading Date.now() during render. The interval callback is the
  // only place we read the wall clock here.
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const initial = setTimeout(tick, 0);
    const interval = setInterval(tick, 15000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, []);

  // Subscribe to the selected conversation's messages.
  useEffect(() => {
    if (!ready || !selectedId) return;
    const db = getFirebaseFirestore();
    const q = query(
      collection(db, "conversations", selectedId, "messages"),
      orderBy("timestamp", "asc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMessages(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Message)
        );
      },
      (err) => {
        console.error("[inbox] messages listener error:", err);
      }
    );
    return () => unsub();
  }, [ready, selectedId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selected = useMemo(
    () => conversations.find((c) => c.waId === selectedId) ?? null,
    [conversations, selectedId]
  );

  const windowOpen = useMemo(() => {
    const expires = toMillis(selected?.serviceWindowExpiresAt);
    return expires != null && expires > nowMs;
  }, [selected, nowMs]);

  async function selectConversation(waId: string) {
    setMessages([]);
    setSelectedId(waId);
    const conv = conversations.find((c) => c.waId === waId);
    if (conv && (conv.unreadCount ?? 0) > 0) {
      try {
        const user = getFirebaseAuth().currentUser;
        if (!user) return;
        const idToken = await user.getIdToken();
        await fetch("/api/whatsapp/mark-read", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ waId }),
        });
      } catch {
        // Non-critical; the badge will simply linger.
      }
    }
  }

  async function handleReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !reply.trim()) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) {
      toast("You are not signed in.", "error");
      return;
    }
    setSending(true);
    try {
      const idToken = await user.getIdToken(true);
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ to: selectedId, mode: "text", message: reply }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast(data.error ?? "Could not send reply.", "error");
        return;
      }
      setReply("");
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
            Inbox
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Link
            href="/admin/dashboard"
            className="rounded-full px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            Send
          </Link>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 md:grid-cols-[320px_1fr]">
        {/* Conversation list */}
        <aside
          className={`border-r border-black/[0.08] dark:border-white/[0.12] ${
            selectedId ? "hidden md:block" : "block"
          }`}
        >
          {conversations.length === 0 ? (
            <p className="px-6 py-8 text-sm text-zinc-500 dark:text-zinc-400">
              No conversations yet. They appear here when someone messages your
              WhatsApp number (requires a published app + webhook subscribed to
              the <code>messages</code> field).
            </p>
          ) : (
            <ul className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
              {conversations.map((c) => {
                const unread = c.unreadCount ?? 0;
                const active = c.waId === selectedId;
                return (
                  <li key={c.waId}>
                    <button
                      type="button"
                      onClick={() => selectConversation(c.waId)}
                      className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                        active ? "bg-zinc-100 dark:bg-zinc-900" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {c.name || `+${c.waId}`}
                        </span>
                        <span className="shrink-0 text-[11px] text-zinc-400">
                          {formatTime(c.lastMessageAt)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {c.lastDirection === "out" ? "You: " : ""}
                          {c.lastMessageText ?? ""}
                        </span>
                        {unread > 0 && (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-medium text-white">
                            {unread}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* Thread */}
        <section
          className={`flex flex-col ${selectedId ? "flex" : "hidden md:flex"}`}
        >
          {!selected ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Select a conversation.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-black/[0.08] px-4 py-3 dark:border-white/[0.12]">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    setMessages([]);
                  }}
                  className="rounded-full px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-800"
                  aria-label="Back"
                >
                  ←
                </button>
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {selected.name || `+${selected.waId}`}
                  </p>
                  <p className="text-[11px] text-zinc-400">+{selected.waId}</p>
                </div>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
                {messages.map((m) => {
                  const out = m.direction === "out";
                  return (
                    <div
                      key={m.id}
                      className={`flex ${out ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                          out
                            ? "bg-emerald-600 text-white"
                            : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">
                          {m.text || `[${m.type}]`}
                        </p>
                        <div
                          className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                            out ? "text-emerald-100" : "text-zinc-400"
                          }`}
                        >
                          <span>{formatTime(m.timestamp)}</span>
                          {out && m.status && (
                            <span>· {STATUS_LABEL[m.status] ?? m.status}</span>
                          )}
                        </div>
                        {out && m.status === "failed" && m.errorTitle && (
                          <p className="mt-1 text-[10px] text-red-200">
                            {m.errorTitle}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={threadEndRef} />
              </div>

              <form
                onSubmit={handleReply}
                className="border-t border-black/[0.08] px-4 py-3 dark:border-white/[0.12]"
              >
                {!windowOpen && (
                  <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
                    The 24-hour reply window is closed. Free-form text will be
                    rejected by WhatsApp — use an approved template from the{" "}
                    <Link href="/admin/dashboard" className="underline">
                      Send
                    </Link>{" "}
                    page instead.
                  </p>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    rows={1}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder={
                      windowOpen ? "Type a reply…" : "Reply window closed"
                    }
                    disabled={sending || !windowOpen}
                    className="max-h-32 flex-1 resize-y rounded-2xl border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none ring-zinc-400 placeholder:text-zinc-400 focus:ring-2 disabled:opacity-60 dark:border-zinc-600"
                  />
                  <button
                    type="submit"
                    disabled={sending || !windowOpen || !reply.trim()}
                    className="flex h-10 shrink-0 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background transition-opacity disabled:opacity-50"
                  >
                    {sending ? "…" : "Send"}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
