# Web WhatsApp

A shared **WhatsApp inbox** for one business on the **WhatsApp Cloud API**. Customers message the business number; their messages (text, photos, voice notes, documents, locations, contacts, reactions, button taps, orders…) arrive through Meta's webhook and are stored in Firestore. Signed-in **operators** read them in real time, reply inside WhatsApp's 24-hour window, and start conversations with **approved templates**.

## Stack

- **Next.js 16** (App Router), **React 19**, **TypeScript**, **Tailwind CSS 4**
- **Firebase Authentication** (email/password) — operator sign-in; access needs the `operator` custom claim
- **Cloud Firestore** — conversations and messages; the browser reads them live, the server writes them
- **Firebase Admin** (service account) — checks operator tokens on the API routes and stores webhook events
- **Meta WhatsApp Cloud API** (Graph) — sending, media download, webhooks

## Project layout

| Area | Path |
|------|------|
| Public home page | `src/app/page.tsx` |
| Operator login | `src/app/admin/login/page.tsx` |
| Send a template or message | `src/app/admin/dashboard/page.tsx` |
| Inbox | `src/app/admin/dashboard/inbox/page.tsx` |
| Webhook (Meta → app) | `src/app/api/whatsapp/webhook/route.ts` |
| Send, mark-read, media APIs | `src/app/api/whatsapp/{send,mark-read,media}/route.ts` |
| Operator check (server) | `src/lib/firebase/operator-auth.ts` |
| Operator check (browser) | `src/lib/firebase/use-operator-session.ts`, `src/components/admin/session-gate.tsx` |
| Webhook parsing / storage | `src/lib/whatsapp/webhook.ts`, `src/lib/whatsapp/store.ts` |
| Graph client | `src/lib/whatsapp/cloud-api.ts` |
| Firestore security rules | `firestore.rules` |
| Grant or remove operators | `scripts/operators.mjs` |

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Other scripts: `npm run build`, `npm run start`, `npm run lint`.

Meta can't reach `localhost`, so real webhook traffic only arrives on a deployed, public HTTPS URL.

## Environment variables

Copy `.env.example` to `.env.local` and fill it in; on a host, set the same keys in its environment settings. `NEXT_PUBLIC_*` values are inlined at **build** time; everything else is read at runtime and must never get a `NEXT_PUBLIC_` prefix.

| Variable | Required | Where it comes from |
|----------|----------|---------------------|
| `WHATSAPP_ACCESS_TOKEN` | yes | Business settings → System users → generate token (`whatsapp_business_messaging`, `whatsapp_business_management`), with the app and the number's WhatsApp accounts assigned. Temporary tokens from API Setup expire within a day. |
| `WHATSAPP_PHONE_NUMBER_ID` | yes | App Dashboard → WhatsApp → API Setup (the **Phone number ID**, not the number) |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | yes | Any long random string (`openssl rand -hex 24`); enter the same value in Meta |
| `WHATSAPP_APP_SECRET` | yes | App Dashboard → App settings → Basic → App secret |
| `WHATSAPP_API_VERSION` | no | Graph API version, default `v25.0` |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID` | yes | Firebase console → Project settings → Your apps → Web app |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, `_APP_ID`, `_MEASUREMENT_ID` | no | Same place |
| `FIREBASE_ADMIN_PROJECT_ID`, `_CLIENT_EMAIL`, `_PRIVATE_KEY` | yes | Firebase console → Project settings → Service accounts → Generate new private key (`project_id`, `client_email`, `private_key`; keep the `\n` escapes) |

## Operators: who can use the inbox

Signing in isn't enough. An account needs the `operator` custom claim, which both `firestore.rules` and the API routes check, because anyone can create an account in a Firebase project from its public web config while sign-up is enabled.

1. Firebase console → Authentication → Sign-in method: enable **Email/Password** only.
2. Authentication → Settings → User actions: turn off **Enable create (sign-up)** (this may ask you to upgrade to Identity Platform, which is free at this scale). Delete any accounts you don't recognise.
3. Give each operator access with the script (it uses the `FIREBASE_ADMIN_*` values in `.env.local`):

   ```bash
   npm run operators -- grant someone@example.com
   npm run operators -- list
   npm run operators -- revoke someone@example.com
   ```

   `grant` creates the account and prints a link where the operator chooses their password; don't create operators in the console. If the address already has an account (yours from testing, say), `grant` refuses: someone else may have registered it while sign-up was open. Re-run with `--reset-existing` to replace its password, remove other sign-in methods and sign it out everywhere before access is granted; the printed link lets the real owner set a new password. A grant applies the next time the operator opens the inbox. A revoke signs them out too: the API rejects them at once, and an inbox they still have open stops receiving data within an hour.
4. Deploy the rules: Firestore Database → Rules → paste `firestore.rules` → Publish (or `npx firebase-tools deploy --only firestore:rules --project <project-id>`). Check that the live rules mention `request.auth.token.operator`.

### Upgrading a deployment of the earlier prototype

The webhook now refuses all events until `WHATSAPP_APP_SECRET` is set, and the inbox needs the operator claim, so do this in order:

1. Set `WHATSAPP_APP_SECRET` (and a fresh `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, re-entered in Meta) in the host's environment **before** deploying. Hosts that deploy on every push will pick up the new code at once.
2. `npm run operators -- grant <your email> --reset-existing`, and open the printed link to set your password.
3. Deploy, then publish `firestore.rules` (step 4 above).
4. Send a test message to the business number. In the host logs, a `WHATSAPP_APP_SECRET is not set` line or HTTP 503s mean the secret is missing; Meta keeps retrying refused events for up to 7 days, so they arrive once it's fixed.

For webhook tests through a tunnel, fill both webhook values in `.env.local` too: a key that is present but empty there overrides the same key in `.env`.

## Connecting WhatsApp

1. Deploy the app to a public HTTPS domain with all the variables above.
2. App Dashboard → WhatsApp → Configuration: callback URL `https://<your-domain>/api/whatsapp/webhook`, verify token = `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, then **Verify and save** and subscribe to the **messages** field.
3. Make sure the app is subscribed to the number's WhatsApp Business Account: `GET /{waba-id}/subscribed_apps`, and `POST` to the same path if it isn't listed.
4. Publish the app (Live mode); some webhooks aren't sent in Development mode.

How the webhook behaves:

- It refuses every event (HTTP 503) until `WHATSAPP_APP_SECRET` is set, and rejects payloads whose `X-Hub-Signature-256` doesn't match (HTTP 401). Unsigned events are never stored.
- It answers 200 only after every message and status in the payload is stored. If a write fails it answers 500, and Meta retries the payload for up to 7 days; writes are keyed by message id, so retries never duplicate anything.
- Customers who use a WhatsApp username and haven't shared their number are stored under their business-scoped user id (BSUID) and replied to by that id.

## How sending works

1. The browser gets the operator's Firebase **ID token** and calls `POST /api/whatsapp/send` with `Authorization: Bearer <idToken>` and JSON: either `conversationId` (a reply from the inbox; the server sends to the customer's current number or user id) or `to` (the Send page: a number in international format, `+…` or `00…`, or a WhatsApp user id), plus `mode` (`text` or `template`) and `message` or `templateName` + `templateLanguage`.
2. The route checks the token and the operator claim, then calls `https://graph.facebook.com/{version}/{phoneNumberId}/messages`. Numbers go to Meta as `+<country code><number>`, as Meta recommends. Typed numbers without `+` or `00` are refused rather than guessed: `(479) 555-0123` would otherwise be read as a Norwegian number.
3. Free-form text only works within 24 hours of the customer's last message. Once that window closes, the inbox offers a template form instead (exact template name and language code). Templates are sent by name and language only, so templates with variables or media headers aren't supported yet.
4. The sent message is stored in the customer's conversation, with the sending operator's uid, and delivery statuses update it.

Customers are matched by their WhatsApp user id (BSUID) first and by number second. When a customer changes their number, WhatsApp's notice moves their thread to the new number; if they had already written from it, the old thread points to the new one and refuses replies. If a different WhatsApp account starts writing from a customer's number (the number was reassigned), it gets its own thread, and the earlier customer's thread stops sending to that number.

## Security notes

- Keep `.env.local` out of git (it is in `.gitignore`); `.env.example` holds placeholders only.
- Rotate any token, app secret or private key that was committed, pasted in chat, or ever given a `NEXT_PUBLIC_` prefix.
- Restrict the Firebase **Web API key** (HTTP referrers) in Google Cloud.
- `next.config.ts` turns off the `/_next/image` optimizer, which nothing here uses.

## License

Private / not specified.
