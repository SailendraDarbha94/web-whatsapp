import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import {
  isMediaType,
  summarizeMessage,
  type MediaContent,
} from "@/lib/whatsapp/message-content";
import type { InboundMessage, StatusUpdate } from "@/lib/whatsapp/webhook";

/**
 * Firestore layout:
 *   conversations/{waId}                       — one per WhatsApp user (E.164 digits)
 *   conversations/{waId}/messages/{wamid}      — every inbound + outbound message
 *
 * Document IDs are the WhatsApp message id (wamid), which makes writes
 * idempotent: Meta retries failed deliveries for up to 7 days and may send
 * the same event to multiple subscribed apps, so the same wamid can arrive
 * more than once. Keying on it turns duplicates into harmless no-ops.
 */

const CONVERSATIONS = "conversations";
const MESSAGES = "messages";

/** WhatsApp's 24h customer-service window, in milliseconds. */
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Cap on the stored copy of Meta's original message JSON. Real messages are a
 * few KB; the cap keeps an oversized payload from pushing the document past
 * Firestore's 1 MiB limit (which would lose the whole message).
 */
const MAX_RAW_JSON_BYTES = 256 * 1024;

function secondsStringToTimestamp(value: string): Timestamp {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Timestamp.fromMillis(seconds * 1000);
  }
  return Timestamp.now();
}

/**
 * Recursively drop `undefined` from plain objects and arrays. The Admin SDK
 * rejects `undefined` field values (ignoreUndefinedProperties is off), and one
 * bad field would fail the whole transaction.
 */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefined(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value; // Timestamp, FieldValue, …
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[key] = stripUndefined(item);
    }
    return out as T;
  }
  return value;
}

/** Meta's original message object as JSON, or undefined if it is too large. */
function serializeRaw(message: InboundMessage): string | undefined {
  try {
    const json = JSON.stringify(message.raw);
    if (Buffer.byteLength(json, "utf8") <= MAX_RAW_JSON_BYTES) return json;
    console.warn(
      "[whatsapp/store] raw payload too large to keep; storing normalized content only:",
      message.id
    );
  } catch (e) {
    console.warn("[whatsapp/store] could not serialize raw payload:", message.id, e);
  }
  return undefined;
}

/**
 * Persist an inbound message and roll it up onto the conversation.
 * Runs in a transaction so duplicate deliveries don't double-count unread
 * or clobber a newer conversation state.
 *
 * Besides type/text, the message document holds the normalized `content`,
 * `context`, `referral` and `errors` (see message-content.ts) and `rawJson`,
 * Meta's original message object, so nothing Meta sends is lost.
 */
export async function recordInboundMessage(
  message: InboundMessage,
  contactName?: string
): Promise<void> {
  if (!message.id || !message.from) {
    // Meta omits `from` for customers who use a WhatsApp username and haven't
    // shared their number (only `from_user_id` is set). Conversations here are
    // keyed by phone, so these can't be stored yet; never drop them silently.
    console.error(
      "[whatsapp/store] inbound message NOT stored (missing " +
        (message.id ? "from" : "id") +
        "):",
      JSON.stringify({
        wamid: message.id || null,
        type: message.type,
        fromUserId: message.fromUserId ?? null,
      })
    );
    return;
  }

  const db = getAdminFirestore();
  const convRef = db.collection(CONVERSATIONS).doc(message.from);
  const msgRef = convRef.collection(MESSAGES).doc(message.id);
  const ts = secondsStringToTimestamp(message.timestamp);
  const windowExpires = Timestamp.fromMillis(ts.toMillis() + SERVICE_WINDOW_MS);
  const messageDoc = stripUndefined({
    id: message.id,
    direction: "in",
    type: message.type,
    text: message.text ?? null,
    content: message.content,
    context: message.context,
    referral: message.referral,
    errors: message.errors,
    rawJson: serializeRaw(message),
    from: message.from,
    fromUserId: message.fromUserId,
    timestamp: ts,
    createdAt: FieldValue.serverTimestamp(),
  });

  const content = message.content;
  const reaction = content?.type === "reaction" ? content : undefined;
  // Edits and deletions change an earlier message; they aren't new activity.
  const changedMessageId =
    content?.type === "edit" || content?.type === "revoke"
      ? content.originalMessageId
      : undefined;
  const changesEarlierMessage = message.type === "edit" || message.type === "revoke";
  // WhatsApp-generated notices (e.g. a number change) aren't customer
  // messages, so they don't open or extend the 24h customer service window.
  const opensServiceWindow = message.type !== "system";
  const summary = summarizeMessage(message);

  await db.runTransaction(async (tx) => {
    // Transactions must do every read before the first write.
    const existing = await tx.get(msgRef);
    const conversation =
      reaction || changesEarlierMessage ? await tx.get(convRef) : undefined;
    const sameTarget = reaction
      ? await tx.get(
          convRef.collection(MESSAGES).where("content.messageId", "==", reaction.messageId)
        )
      : undefined;
    if (existing.exists) return; // already stored — idempotent no-op

    tx.set(msgRef, messageDoc);
    const data = conversation?.data();

    if (changesEarlierMessage) {
      // Only the preview can change, and only if it shows the changed message.
      if (changedMessageId && data?.lastMessageId === changedMessageId) {
        tx.set(
          convRef,
          { lastMessageText: summary, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      }
      return;
    }

    // Whether the preview currently shows a reaction to the same message.
    const showsThisReaction =
      !!reaction &&
      data?.lastMessageType === "reaction" &&
      data.lastReactionTargetId === reaction.messageId;

    if (reaction) {
      // Meta doesn't guarantee delivery order. If a later reaction event for
      // the same message is already stored, this one is stale: keep it in the
      // history, but leave the conversation as the newer event set it.
      const superseded = sameTarget?.docs.some(
        (doc) => doc.id !== message.id && isLaterThan(doc.get("timestamp"), ts)
      );
      if (superseded) return;

      if (!reaction.emoji) {
        // Removal: undo the reaction's preview and unread count, but only if
        // it is still what the conversation shows.
        if (showsThisReaction) {
          const unread = typeof data?.unreadCount === "number" ? data.unreadCount : 0;
          tx.set(
            convRef,
            {
              lastMessageText: summary,
              lastReactionTargetId: FieldValue.delete(),
              unreadCount: Math.max(0, unread - 1),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        return;
      }
    }

    tx.set(
      convRef,
      {
        waId: message.from,
        ...(contactName ? { name: contactName } : {}),
        ...(message.fromUserId ? { userId: message.fromUserId } : {}),
        lastMessageId: message.id,
        lastMessageText: summary,
        lastMessageType: message.type,
        lastMessageAt: ts,
        lastDirection: "in",
        lastReactionTargetId: reaction?.messageId ?? FieldValue.delete(),
        ...(opensServiceWindow ? { serviceWindowExpiresAt: windowExpires } : {}),
        // A changed emoji replaces a reaction that was already counted.
        ...(showsThisReaction ? {} : { unreadCount: FieldValue.increment(1) }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

function isLaterThan(value: unknown, ts: Timestamp): boolean {
  return value instanceof Timestamp && value.toMillis() > ts.toMillis();
}

/**
 * Media details of an inbound message, or null if the message doesn't exist,
 * isn't inbound, or has no media. The media route uses this so it only ever
 * downloads media a customer actually sent to this inbox.
 */
export async function getInboundMedia(
  waId: string,
  wamid: string
): Promise<MediaContent | null> {
  const snap = await getAdminFirestore()
    .collection(CONVERSATIONS)
    .doc(waId)
    .collection(MESSAGES)
    .doc(wamid)
    .get();
  if (!snap.exists || snap.get("direction") !== "in") return null;

  const content: unknown = snap.get("content");
  if (typeof content !== "object" || content === null) return null;
  const { type, mediaId } = content as { type?: unknown; mediaId?: unknown };
  if (typeof type !== "string" || !isMediaType(type)) return null;
  if (typeof mediaId !== "string" || !mediaId) return null;
  return content as MediaContent;
}

/**
 * Persist a message we just sent via the Cloud API so the thread shows both
 * sides. A later `statuses` webhook upgrades `status` (sent → delivered → read).
 */
export async function recordOutboundMessage(params: {
  wamid: string;
  to: string;
  type: string;
  text?: string;
}): Promise<void> {
  const { wamid, to, type, text } = params;
  if (!wamid || !to) return;

  const db = getAdminFirestore();
  const convRef = db.collection(CONVERSATIONS).doc(to);
  const msgRef = convRef.collection(MESSAGES).doc(wamid);
  const now = Timestamp.now();

  const batch = db.batch();
  batch.set(
    msgRef,
    {
      id: wamid,
      direction: "out",
      type,
      text: text ?? null,
      to,
      status: "sent",
      timestamp: now,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  batch.set(
    convRef,
    {
      waId: to,
      lastMessageId: wamid,
      lastMessageText: text ?? `[${type}]`,
      lastMessageType: type,
      lastMessageAt: now,
      lastDirection: "out",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await batch.commit();
}

/** Clear a conversation's unread counter (called when an admin opens it). */
export async function markConversationRead(waId: string): Promise<void> {
  if (!waId) return;
  const db = getAdminFirestore();
  await db
    .collection(CONVERSATIONS)
    .doc(waId)
    .set(
      { unreadCount: 0, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
}

const STATUS_RANK: Record<string, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

/**
 * Apply a delivery-status webhook to the matching outbound message. Only moves
 * status forward (sent → delivered → read) so out-of-order retries can't
 * regress a "read" back to "delivered". `failed` always wins.
 */
export async function recordStatusUpdate(status: StatusUpdate): Promise<void> {
  if (!status.id || !status.recipientId || !status.status) return;

  const db = getAdminFirestore();
  const msgRef = db
    .collection(CONVERSATIONS)
    .doc(status.recipientId)
    .collection(MESSAGES)
    .doc(status.id);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(msgRef);
    if (!snap.exists) return; // status for a message we never recorded

    const current = (snap.data()?.status as string | undefined) ?? "sent";
    const incoming = status.status;
    const isFailure = incoming === "failed";
    // Own-property lookups: unknown values (including "__proto__") rank 0 and are ignored.
    const rank = (s: string) => (Object.hasOwn(STATUS_RANK, s) ? STATUS_RANK[s] : 0);
    if (!isFailure && rank(incoming) <= rank(current)) {
      return;
    }

    tx.set(
      msgRef,
      {
        status: incoming,
        statusAt: secondsStringToTimestamp(status.timestamp),
        ...(status.errorTitle ? { errorTitle: status.errorTitle } : {}),
        ...(status.errorCode != null ? { errorCode: status.errorCode } : {}),
      },
      { merge: true }
    );
  });
}
