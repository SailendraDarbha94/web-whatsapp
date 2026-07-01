import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "BulkChat — WhatsApp Messaging at Scale",
  description:
    "Send WhatsApp messages to thousands of contacts in minutes. Manage recipients, craft campaigns, and track delivery — all from one dashboard.",
};

const features = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
    title: "Bulk recipient management",
    body: "Upload contact lists, segment by tag, and target exactly the right audience. No more manual message-by-message sends.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
      </svg>
    ),
    title: "Dynamic message templates",
    body: "Personalise at scale with variables like first name or order number. Every message feels one-to-one even when sent to thousands.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    title: "Real-time delivery analytics",
    body: "Track sent, delivered, and read receipts as they happen. Know exactly how your messages perform without guesswork.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: "Scheduled campaigns",
    body: "Queue messages to go out at the perfect time — whether that's right now or next Tuesday at 9 AM in your recipient's timezone.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
    title: "WhatsApp Business API",
    body: "Built on the official Meta Cloud API — enterprise-grade reliability, compliance with WhatsApp policies, and no third-party risk.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
    title: "Simple REST API",
    body: "Integrate send triggers into your own product flows with a single HTTP call. Full API docs included — no SDK required.",
  },
];

const steps = [
  {
    number: "01",
    title: "Connect your WhatsApp Business number",
    body: "Link your Meta Business account in minutes. We handle the OAuth flow and phone number verification for you.",
  },
  {
    number: "02",
    title: "Upload your contact list",
    body: "Paste numbers, upload a CSV, or push contacts via API. Tag and segment them however your workflow requires.",
  },
  {
    number: "03",
    title: "Compose and send",
    body: "Write your message, add personalisation variables, preview it, and hit send — or schedule it for later.",
  },
];

const stats = [
  { value: "10M+", label: "Messages delivered" },
  { value: "99.8%", label: "Delivery success rate" },
  { value: "<2s", label: "Average send latency" },
  { value: "150+", label: "Countries reached" },
];

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-white font-sans dark:bg-zinc-950">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-zinc-100 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-white">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.126.555 4.122 1.528 5.855L.057 23.268a.75.75 0 00.917.911l5.532-1.453A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.73 9.73 0 01-4.964-1.356l-.356-.212-3.686.968.985-3.595-.232-.37A9.72 9.72 0 012.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z" />
              </svg>
            </span>
            <span className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-white">BulkChat</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm font-medium text-zinc-600 dark:text-zinc-400 md:flex">
            <a href="#features" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-zinc-900 dark:hover:text-white transition-colors">How it works</a>
            <a href="#pricing" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Pricing</a>
          </nav>
          <Link
            href="/admin/login"
            className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-600"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="flex flex-col">
        {/* Hero */}
        <section className="relative overflow-hidden bg-white dark:bg-zinc-950">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[600px] w-[600px] rounded-full bg-emerald-50 opacity-60 blur-3xl dark:bg-emerald-950/40" />
          </div>

          <div className="relative mx-auto max-w-6xl px-6 py-24 text-center sm:py-32">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-sm font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Powered by WhatsApp Business API
            </div>

            <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-zinc-900 dark:text-white sm:text-5xl lg:text-6xl lg:leading-tight">
              Send WhatsApp messages{" "}
              <span className="text-emerald-500">to thousands</span>
              {" "}in minutes
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
              One dashboard to manage recipients, craft personalised campaigns, and track delivery — built for teams that run WhatsApp outreach at scale.
            </p>

            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                href="/admin/login"
                className="w-full rounded-full bg-emerald-500 px-8 py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-emerald-600 sm:w-auto"
              >
                Get started free
              </Link>
              <a
                href="#how-it-works"
                className="w-full rounded-full border border-zinc-200 bg-white px-8 py-3.5 text-base font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 sm:w-auto"
              >
                See how it works
              </a>
            </div>

            {/* Hero mock UI */}
            <div className="mt-16 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-5 py-3 dark:border-zinc-800 dark:bg-zinc-950">
                <span className="h-3 w-3 rounded-full bg-red-400" />
                <span className="h-3 w-3 rounded-full bg-yellow-400" />
                <span className="h-3 w-3 rounded-full bg-green-400" />
                <span className="ml-4 text-xs text-zinc-400">BulkChat dashboard</span>
              </div>
              <div className="grid grid-cols-1 divide-y divide-zinc-200 dark:divide-zinc-800 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <div className="p-6 text-left">
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">New campaign</p>
                  <div className="mt-3 space-y-2">
                    <div className="h-8 rounded-lg bg-zinc-200 dark:bg-zinc-700" />
                    <div className="h-20 rounded-lg bg-zinc-200 dark:bg-zinc-700" />
                    <div className="h-8 w-2/3 rounded-lg bg-zinc-200 dark:bg-zinc-700" />
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <div className="h-9 flex-1 rounded-full bg-emerald-500 opacity-80" />
                  </div>
                </div>
                <div className="p-6 text-left">
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">Recipients</p>
                  <ul className="mt-3 space-y-2">
                    {["+1 555 0101", "+44 7700 9001", "+61 4 1234 5678", "+91 98765 43210"].map((n) => (
                      <li key={n} className="flex items-center gap-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                          {n[1]}
                        </span>
                        <span className="text-sm text-zinc-600 dark:text-zinc-400">{n}</span>
                        <span className="ml-auto h-2 w-2 rounded-full bg-emerald-400" />
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="p-6 text-left">
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">Delivery stats</p>
                  <div className="mt-3">
                    <p className="text-3xl font-bold text-zinc-900 dark:text-white">2,418</p>
                    <p className="text-sm text-zinc-500">messages sent</p>
                  </div>
                  <div className="mt-4 space-y-2">
                    {[
                      { label: "Delivered", pct: 99, color: "bg-emerald-500" },
                      { label: "Read", pct: 76, color: "bg-emerald-300" },
                      { label: "Failed", pct: 1, color: "bg-red-400" },
                    ].map((s) => (
                      <div key={s.label}>
                        <div className="mb-1 flex justify-between text-xs text-zinc-500">
                          <span>{s.label}</span>
                          <span>{s.pct}%</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-700">
                          <div className={`h-1.5 rounded-full ${s.color}`} style={{ width: `${s.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="border-y border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto max-w-6xl px-6 py-12">
            <dl className="grid grid-cols-2 gap-8 text-center sm:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt className="text-3xl font-bold text-zinc-900 dark:text-white">{s.value}</dt>
                  <dd className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{s.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl px-6 py-24">
          <div className="text-center">
            <p className="text-sm font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Features</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-4xl">
              Everything you need to send at scale
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
              From a handful of messages to millions — BulkChat handles the infrastructure so you can focus on what to say.
            </p>
          </div>

          <ul className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <li
                key={f.title}
                className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                  {f.icon}
                </div>
                <h3 className="mt-4 font-semibold text-zinc-900 dark:text-white">{f.title}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="bg-zinc-50 dark:bg-zinc-900">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="text-center">
              <p className="text-sm font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">How it works</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-4xl">
                Up and running in under 10 minutes
              </h2>
            </div>

            <ol className="mt-16 grid gap-8 sm:grid-cols-3">
              {steps.map((step) => (
                <li key={step.number} className="relative flex flex-col gap-4">
                  <span className="text-5xl font-black text-emerald-100 dark:text-emerald-950/80">{step.number}</span>
                  <h3 className="-mt-2 font-semibold text-zinc-900 dark:text-white">{step.title}</h3>
                  <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* CTA */}
        <section id="pricing" className="mx-auto w-full max-w-6xl px-6 py-24">
          <div className="relative overflow-hidden rounded-3xl bg-emerald-500 px-8 py-16 text-center shadow-xl sm:px-16">
            <div className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full bg-white/10" />
            <div className="pointer-events-none absolute -bottom-20 -right-20 h-80 w-80 rounded-full bg-white/10" />

            <h2 className="relative text-3xl font-bold text-white sm:text-4xl">
              Start sending WhatsApp messages today
            </h2>
            <p className="relative mx-auto mt-4 max-w-md text-base text-emerald-50">
              Get started for free. No credit card required. Scale as you grow.
            </p>
            <div className="relative mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                href="/admin/login"
                className="w-full rounded-full bg-white px-8 py-3.5 text-base font-semibold text-emerald-600 shadow-sm transition-colors hover:bg-emerald-50 sm:w-auto"
              >
                Get started free
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-100 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500 text-white">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.126.555 4.122 1.528 5.855L.057 23.268a.75.75 0 00.917.911l5.532-1.453A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.73 9.73 0 01-4.964-1.356l-.356-.212-3.686.968.985-3.595-.232-.37A9.72 9.72 0 012.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z" />
              </svg>
            </span>
            BulkChat
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            © {new Date().getFullYear()} BulkChat. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}