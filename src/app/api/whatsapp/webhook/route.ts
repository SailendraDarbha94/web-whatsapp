import {
  parseMessagesPayload,
  profileFor,
  verifyWebhookSignature,
  type ParsedMessagesPayload,
} from "@/lib/whatsapp/webhook";
import {
  recordInboundMessage,
  recordStatusUpdate,
  RetryLaterError,
} from "@/lib/whatsapp/store";

export const runtime = "nodejs";

/**
 * GET = Meta's verification handshake. When configuring the callback URL,
 * Meta calls this with hub.mode/hub.verify_token/hub.challenge and expects
 * the challenge echoed back as plain text if the verify token matches ours.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim();

  if (!expected) {
    console.error(
      "[whatsapp/webhook] WHATSAPP_WEBHOOK_VERIFY_TOKEN is not set; cannot verify."
    );
    return new Response("Webhook not configured.", { status: 500 });
  }

  if (mode === "subscribe" && token === expected && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new Response("Forbidden", { status: 403 });
}

/**
 * POST = event delivery (inbound messages + outbound status updates).
 *
 * Only payloads signed with the app secret are processed; without the secret
 * configured, nothing is. Meta retries any non-200 answer for up to 7 days,
 * so this returns 200 only once every event in the payload is stored. Writes
 * are idempotent (keyed by message id), so retrying a partly stored payload
 * is safe.
 */
export async function POST(request: Request) {
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!appSecret) {
    // Fail closed: accepting unsigned events would let anyone who finds this
    // URL write fake customer messages. Meta keeps retrying until it's set.
    console.error(
      "[whatsapp/webhook] WHATSAPP_APP_SECRET is not set; refusing events until it is (Meta will retry)."
    );
    return new Response("Webhook not configured.", { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyWebhookSignature(rawBody, signature, appSecret)) {
    console.warn("[whatsapp/webhook] Invalid signature; rejecting payload.");
    return new Response("Invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    // Signed but unreadable: a retry would be identical, so don't ask for one.
    console.warn("[whatsapp/webhook] Non-JSON body received.");
    return new Response("OK", { status: 200 });
  }

  let parsed: ParsedMessagesPayload;
  try {
    parsed = parseMessagesPayload(body);
  } catch (e) {
    // A parser bug: let Meta retry, so the events arrive once it's fixed.
    console.error("[whatsapp/webhook] failed to parse payload:", e);
    return new Response("Could not process payload.", { status: 500 });
  }

  const { inbound, statuses, contacts } = parsed;
  let failed = 0;

  // Sequential: payloads are small, and this keeps a conversation's writes in order.
  for (const m of inbound) {
    try {
      await recordInboundMessage(m, profileFor(contacts, m));
    } catch (e) {
      failed++;
      console.error("[whatsapp/webhook] failed to store inbound:", m.id, e);
    }
  }

  for (const s of statuses) {
    try {
      await recordStatusUpdate(s);
    } catch (e) {
      failed++;
      if (e instanceof RetryLaterError) {
        console.warn(`[whatsapp/webhook] ${e.message}; asking Meta to retry.`);
      } else {
        console.error("[whatsapp/webhook] failed to store status:", s.id, e);
      }
    }
  }

  if (inbound.length === 0 && statuses.length === 0) {
    console.log(
      "[whatsapp/webhook] received payload with no messages/statuses:",
      JSON.stringify(body)
    );
  }

  if (failed > 0) {
    return new Response("Storage failed; please retry.", { status: 500 });
  }
  return new Response("OK", { status: 200 });
}
