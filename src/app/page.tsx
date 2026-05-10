import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Web WhatsApp — Outbound messaging",
  description:
    "Send WhatsApp messages to different people from one place. Reach customers, teams, or contacts with reliable outbound delivery.",
};

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-between gap-16 py-24 px-8 sm:px-16 bg-white dark:bg-black sm:items-start">
        <div className="flex w-full flex-col gap-2">
          <p className="text-sm font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            Outbound WhatsApp
          </p>
          <h1 className="max-w-xl text-3xl font-semibold leading-tight tracking-tight text-black dark:text-zinc-50 sm:text-4xl sm:leading-tight">
            Send WhatsApp messages to the right people, at scale
          </h1>
          <p className="max-w-xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            One service to manage recipients, craft messages, and deliver over
            WhatsApp—whether you are notifying customers, coordinating a team,
            or reaching a list of contacts.
          </p>
        </div>

        <ul className="grid w-full gap-4 sm:grid-cols-3">
          {[
            {
              title: "Targeted sends",
              body: "Reach individuals or groups with messages tailored to each audience.",
            },
            {
              title: "Centralized control",
              body: "Keep outbound traffic in one place instead of juggling devices.",
            },
            {
              title: "Built for operators",
              body: "An admin experience designed for people who run messaging day to day.",
            },
          ].map((item) => (
            <li
              key={item.title}
              className="rounded-2xl border border-black/[0.08] bg-zinc-50/80 p-5 dark:border-white/[0.12] dark:bg-zinc-950/50"
            >
              <h2 className="font-medium text-zinc-900 dark:text-zinc-100">
                {item.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {item.body}
              </p>
            </li>
          ))}
        </ul>

        <div className="flex w-full flex-col gap-4 text-base font-medium sm:flex-row sm:items-center">
          <Link
            className="flex h-12 w-full items-center justify-center rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc] sm:w-auto"
            href="/admin/login"
          >
            Admin sign in
          </Link>
          <p className="text-center text-sm font-normal text-zinc-500 sm:text-left dark:text-zinc-400">
            Operators can sign in to manage messaging and settings.
          </p>
        </div>
      </main>
    </div>
  );
}
