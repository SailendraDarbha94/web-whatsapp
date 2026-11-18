import { NextResponse } from "next/server";
import { authorizeOperator } from "@/lib/firebase/operator-auth";
import {
  formatRecipient,
  parseTypedRecipient,
  sendWhatsAppMessage,
  type GraphSuccessResponse,
  type WhatsAppRecipient,
} from "@/lib/whatsapp/cloud-api";
import { isConversationId, isPhoneId } from "@/lib/whatsapp/ids";
import {
  getConversationRecipient,
  recordOutboundMessage,
  type ReplyTarget,
} from "@/lib/whatsapp/store";

export const runtime = "nodejs";

type Body = {
  /** Reply in an existing conversation (the inbox): the server picks the customer's current id. */
  conversationId?: unknown;
  /** A number typed by an operator, in international format, or a BSUID. */
  to?: unknown;
  mode?: unknown;
  message?: unknown;
  templateName?: unknown;
  templateLanguage?: unknown;
};

type Target = { recipient: WhatsAppRecipient; conversationId?: string };

export async function POST(request: Request) {
  const auth = await authorizeOperator(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let json: Body;
  try {
    json = ((await request.json()) ?? {}) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let target: Target;
  if (typeof json.conversationId === "string" && json.conversationId.trim()) {
    const conversationId = json.conversationId.trim();
    if (!isConversationId(conversationId)) {
      return NextResponse.json({ error: "Invalid conversation id." }, { status: 400 });
    }
    let reply: ReplyTarget | null;
    try {
      reply = await getConversationRecipient(conversationId);
    } catch (e) {
      console.error("[api/whatsapp/send] conversation lookup failed:", e);
      return NextResponse.json({ error: "Could not look up the conversation." }, { status: 500 });
    }
    if (!reply) {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }
    if (!reply.ok) {
      // The customer moved to another thread, or their number was reassigned.
      return NextResponse.json({ error: reply.error }, { status: 409 });
    }
    target = { recipient: reply.recipient, conversationId };
  } else {
    const to = typeof json.to === "string" ? json.to.trim() : "";
    if (!to) {
      return NextResponse.json({ error: "Field `to` is required." }, { status: 400 });
    }
    try {
      target = { recipient: parseTypedRecipient(to) };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invalid phone number.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  const mode = json.mode === "template" ? "template" : "text";

  try {
    if (mode === "text") {
      const message = typeof json.message === "string" ? json.message : "";
      if (!message.trim()) {
        return NextResponse.json(
          { error: "Field `message` is required for text mode." },
          { status: 400 }
        );
      }
      const result = await sendWhatsAppMessage({ mode: "text", recipient: target.recipient, body: message });
      await persistOutbound(result, target, "text", message, auth.uid);
      return NextResponse.json({ ok: true, to: formatRecipient(target.recipient), result });
    }

    const templateName = typeof json.templateName === "string" ? json.templateName.trim() : "";
    if (!templateName) {
      return NextResponse.json(
        { error: "Field `templateName` is required for template mode." },
        { status: 400 }
      );
    }
    const templateLanguage =
      typeof json.templateLanguage === "string" && json.templateLanguage.trim()
        ? json.templateLanguage.trim()
        : "en_US";

    const result = await sendWhatsAppMessage({
      mode: "template",
      recipient: target.recipient,
      templateName,
      templateLanguage,
    });
    await persistOutbound(result, target, "template", `[template: ${templateName}]`, auth.uid);
    return NextResponse.json({ ok: true, to: formatRecipient(target.recipient), result });
  } catch (e: unknown) {
    const err = e as Error & { status?: number };
    const message = err.message || "Request failed.";
    if (message.includes("WhatsApp env not loaded")) {
      console.error("WhatsApp send configuration:", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
    const status =
      typeof err.status === "number" && err.status >= 400 && err.status <= 599
        ? err.status
        : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * A reply stays in its conversation. A message to a typed number goes to the
 * conversation for the wa_id Meta resolved the number to (the id the
 * customer's replies arrive with), or for the BSUID.
 */
function conversationFor(
  target: Target,
  result: GraphSuccessResponse | null
): { conversationId: string; exact: boolean; userIdHint?: string } {
  if (target.conversationId) return { conversationId: target.conversationId, exact: true };
  const { recipient } = target;
  if (recipient.kind === "user") return { conversationId: recipient.userId, exact: false };
  const contact = result?.contacts?.[0];
  const waId = contact?.wa_id;
  return {
    conversationId: typeof waId === "string" && isPhoneId(waId) ? waId : recipient.digits,
    exact: false,
    userIdHint: typeof contact?.user_id === "string" ? contact.user_id : undefined,
  };
}

async function persistOutbound(
  result: GraphSuccessResponse | null,
  target: Target,
  type: string,
  text: string,
  sentBy: string
): Promise<void> {
  try {
    const wamid = result?.messages?.[0]?.id;
    if (!wamid) return;
    await recordOutboundMessage({
      wamid,
      ...conversationFor(target, result),
      type,
      text,
      sentBy,
    });
  } catch (e) {
    // Never fail the send because the local mirror write failed.
    console.error("[api/whatsapp/send] failed to persist outbound:", e);
  }
}
