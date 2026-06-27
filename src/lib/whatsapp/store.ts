import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
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

function secondsStringToTimestamp(value: string): Timestamp {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Timestamp.fromMillis(seconds * 1000);
  }
  return Timestamp.now();
}

/**
 * Persist an inbound message and roll it up onto the conversation.
 * Runs in a transaction so duplicate deliveries don't double-count unread
 * or clobber a newer conversation state.
 */
export async function recordInboundMessage(
  message: InboundMessage,
  contactName?: string
): Promise<void> {
  if (!message.id || !message.from) return;

  const db = getAdminFirestore();
  const convRef = db.collection(CONVERSATIONS).doc(message.from);
  const msgRef = convRef.collection(MESSAGES).doc(message.id);
  const ts = secondsStringToTimestamp(message.timestamp);
  const windowExpires = Timestamp.fromMillis(ts.toMillis() + SERVICE_WINDOW_MS);

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(msgRef);
    if (existing.exists) return; // already stored — idempotent no-op

    tx.set(msgRef, {
      id: message.id,
      direction: "in",
      type: message.type,
      text: message.text ?? null,
      from: message.from,
      timestamp: ts,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(
      convRef,
      {
        waId: message.from,
        ...(contactName ? { name: contactName } : {}),
        lastMessageText: message.text ?? `[${message.type}]`,
        lastMessageType: message.type,
        lastMessageAt: ts,
        lastDirection: "in",
        serviceWindowExpiresAt: windowExpires,
        unreadCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
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
    if (!isFailure && (STATUS_RANK[incoming] ?? 0) <= (STATUS_RANK[current] ?? 0)) {
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
