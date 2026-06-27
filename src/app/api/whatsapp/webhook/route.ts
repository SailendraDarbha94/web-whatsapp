import {
  parseMessagesPayload,
  verifyWebhookSignature,
} from "@/lib/whatsapp/webhook";
import {
  recordInboundMessage,
  recordStatusUpdate,
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

  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

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
 * Always respond 200 quickly so Meta doesn't retry. Log-only for now.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (appSecret) {
    const signature = request.headers.get("x-hub-signature-256");
    const valid = verifyWebhookSignature(rawBody, signature, appSecret);
    if (!valid) {
      console.warn("[whatsapp/webhook] Invalid signature; rejecting payload.");
      return new Response("Invalid signature", { status: 401 });
    }
  } else {
    console.warn(
      "[whatsapp/webhook] WHATSAPP_APP_SECRET not set; skipping signature check (dev only)."
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.warn("[whatsapp/webhook] Non-JSON body received.");
    return new Response("OK", { status: 200 });
  }

  try {
    const { inbound, statuses, contacts } = parseMessagesPayload(body);

    // Persist sequentially; payloads are small and this keeps Firestore writes
    // ordered. We still return 200 quickly afterwards so Meta doesn't retry.
    for (const m of inbound) {
      try {
        await recordInboundMessage(m, contacts[m.from]);
      } catch (e) {
        console.error("[whatsapp/webhook] failed to store inbound:", m.id, e);
      }
    }

    for (const s of statuses) {
      try {
        await recordStatusUpdate(s);
      } catch (e) {
        console.error("[whatsapp/webhook] failed to store status:", s.id, e);
      }
    }

    if (inbound.length === 0 && statuses.length === 0) {
      console.log(
        "[whatsapp/webhook] received payload with no messages/statuses:",
        JSON.stringify(body)
      );
    }
  } catch (e) {
    console.error("[whatsapp/webhook] failed to parse payload:", e);
  }

  return new Response("OK", { status: 200 });
}
