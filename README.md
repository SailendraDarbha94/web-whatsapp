# Web WhatsApp

Outbound **WhatsApp messaging** for operators: sign in as an admin, pick a recipient number, and send **approved templates** or **free-form text** (when Meta’s messaging window allows it) through the **WhatsApp Cloud API**. The public site explains the product; authenticated users use the admin dashboard and a server-protected API route.

## Stack

- **Next.js 16** (App Router), **React 19**, **TypeScript**
- **Tailwind CSS 4** — layout and admin UI
- **Firebase Authentication** (email/password) — client sign-in
- **Firebase Admin** (service account) — verifies ID tokens on `POST /api/whatsapp/send`
- **Meta WhatsApp Cloud API** (Graph) — `POST /{phone-number-id}/messages`
- Custom **React Context** toasts (top-right)

## Project layout

| Area | Path |
|------|------|
| Marketing home | `src/app/page.tsx` |
| Admin login | `src/app/admin/login/page.tsx` |
| Admin dashboard (send UI) | `src/app/admin/dashboard/page.tsx` |
| Send API | `src/app/api/whatsapp/send/route.ts` |
| Firebase client bootstrap | `src/lib/firebase/firebaseConfig.ts` (reads `NEXT_PUBLIC_FIREBASE_*`) |
| Firebase Admin (server) | `src/lib/firebase/admin.ts` |
| WhatsApp Graph client | `src/lib/whatsapp/cloud-api.ts` |
| Toast provider | `src/contexts/toast-context.tsx`, `src/components/providers.tsx` |

`/admin` redirects to `/admin/login`.

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm run build   # production build
npm run start   # run production server
npm run lint    # ESLint
```

## Environment variables

Copy `.env.example` to `.env.local` in the **project root** (next to `package.json`) and fill every value. Restart the dev server after changes.

### Firebase client (browser)

These are exposed to the client via the `NEXT_PUBLIC_` prefix (normal for Firebase Web). See Firebase Console → Project settings → Your apps.

| Variable | Typical source |
|----------|----------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Web app `apiKey` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `projectId` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | `appId` |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | `measurementId` (optional) |

### Firebase Admin (server only)

Used only to verify Firebase ID tokens on the send API. Firebase Console → Project settings → **Service accounts** → generate a private key JSON:

| Variable | JSON field |
|----------|------------|
| `FIREBASE_ADMIN_PROJECT_ID` | `project_id` |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | `client_email` |
| `FIREBASE_ADMIN_PRIVATE_KEY` | `private_key` (one line in `.env`, `\n` escapes as in JSON) |

**Never** prefix these with `NEXT_PUBLIC_`.

### WhatsApp Cloud API (server only)

Meta for Developers → your app → WhatsApp → API setup. Use a current token with **`whatsapp_business_messaging`** (temporary token, system user, etc., per Meta’s docs).

| Variable | Meaning |
|----------|---------|
| `WHATSAPP_ACCESS_TOKEN` | Bearer token for Graph |
| `WHATSAPP_PHONE_NUMBER_ID` | **Phone number ID** in the Graph path `.../vXX.X/{id}/messages` |
| `WHATSAPP_API_VERSION` | e.g. `v25.0` |

**Never** expose `WHATSAPP_ACCESS_TOKEN` or the service account key to the browser.

## How sending works

1. The user signs in on the client; Firebase Auth provides an **ID token**.
2. The dashboard calls `POST /api/whatsapp/send` with `Authorization: Bearer <idToken>` and JSON (`to`, `mode`, and either template fields or text body).
3. The route verifies the token with Firebase Admin, then calls `https://graph.facebook.com/{version}/{phoneNumberId}/messages` with `WHATSAPP_ACCESS_TOKEN`.
4. **Template** mode matches Meta’s template payload (e.g. `hello_world` / `en_US`). **Text** mode sends a free-form body and is only appropriate when Meta allows it (e.g. inside a customer care window).

Sanity-check failures with Meta’s own `curl` from the developer console; if `curl` fails, fix the token or phone number ID before debugging the app.

## Security notes

- Keep **`.env.local` out of git** (see `.gitignore`). Commit **`.env.example`** with empty placeholders only.
- Rotate any token or private key that was committed, pasted in chat, or ever prefixed with **`NEXT_PUBLIC_` by mistake**.
- Restrict the Firebase **Web API key** (HTTP referrers / apps) in Google Cloud; consider **Firebase App Check** for production.
- WhatsApp and Admin credentials belong only in server-side env vars.

## Deploying (e.g. Vercel)

Add the same variables in the host’s environment settings, then deploy. `NEXT_PUBLIC_*` must be set at **build time** for Next.js to inline them correctly.

## License

Private / not specified.
