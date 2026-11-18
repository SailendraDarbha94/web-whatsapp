import {
  FieldValue,
  Timestamp,
  type CollectionReference,
  type DocumentReference,
  type DocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import type { WhatsAppRecipient } from "@/lib/whatsapp/cloud-api";
import {
  isConversationId,
  isPhoneId,
  isUserId,
  isValidDocumentId,
} from "@/lib/whatsapp/ids";
import {
  isMediaType,
  summarizeMessage,
  type MediaContent,
} from "@/lib/whatsapp/message-content";
import type { ContactProfile, InboundMessage, StatusUpdate } from "@/lib/whatsapp/webhook";

/**
 * Firestore layout:
 *   conversations/{customerId}                  — one per WhatsApp customer
 *   conversations/{customerId}/messages/{wamid} — every inbound + outbound message
 *
 * A conversation belongs to one WhatsApp account. Its id is the customer's
 * wa_id (phone digits with country code), or their business-scoped user id
 * (BSUID) when there's no number or the number's id is already taken by an
 * earlier holder of the number. Fields:
 *   waId / userId                     the customer's current number and BSUID
 *   previousWaIds / previousUserIds   ids they had before (number changes)
 *   continuedIn                       their thread after a number change, when
 *                                     they had already written from the new ids
 *   numberReassignedAt                a different account now has the number
 *
 * Customers are found by BSUID first (current or previous), then by the
 * number they currently use; a number never joins a thread that belongs to a
 * different BSUID. Replies go to the current waId, else the current userId.
 *
 * Message document ids are the WhatsApp message id (wamid), which makes
 * writes idempotent: Meta retries failed deliveries for up to 7 days and may
 * send the same event to multiple subscribed apps, so the same wamid can
 * arrive more than once. Keying on it turns duplicates into harmless no-ops.
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

/** How long a status for a message we haven't stored yet is worth a retry. */
const STATUS_RETRY_WINDOW_MS = 2 * 60 * 1000;

/** The event can't be stored yet; the webhook should ask Meta to deliver it again. */
export class RetryLaterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryLaterError";
  }
}

function secondsStringToTimestamp(value: string): Timestamp {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Timestamp.fromMillis(seconds * 1000);
  }
  return Timestamp.now();
}

function timestampMillis(value: unknown): number | undefined {
  return value instanceof Timestamp ? value.toMillis() : undefined;
}

function isLaterThan(value: unknown, ts: Timestamp): boolean {
  const ms = timestampMillis(value);
  return ms !== undefined && ms > ts.toMillis();
}

function validUserId(value: unknown): string | undefined {
  return typeof value === "string" && isUserId(value) ? value : undefined;
}

function validPhone(value: unknown): string | undefined {
  return typeof value === "string" && isPhoneId(value) ? value : undefined;
}

function includes(list: unknown, value: string | undefined): boolean {
  return value !== undefined && Array.isArray(list) && list.includes(value);
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
 * WhatsApp's notice that the customer's number or BSUID changed. A
 * user_changed_user_id notice may come without `from` or `from_user_id`; its
 * ids are inside the notice.
 */
type IdentityChange = {
  kind?: "user_changed_number" | "user_changed_user_id";
  newWaId?: string;
  newUserId?: string;
  previousUserId?: string;
};

function identityChange(message: InboundMessage): IdentityChange {
  const content = message.content;
  if (content?.type !== "system") return {};
  if (content.systemType !== "user_changed_number" && content.systemType !== "user_changed_user_id") {
    return {};
  }
  return {
    kind: content.systemType,
    newWaId: validPhone(content.newWaId),
    newUserId: validUserId(content.userId),
    previousUserId: validUserId(content.previousUserId),
  };
}

type Found = { ref: DocumentReference; snapshot: DocumentSnapshot };

async function firstMatch(
  tx: Transaction,
  conversations: CollectionReference,
  field: "userId" | "waId" | "previousUserIds",
  op: "==" | "array-contains",
  value: string
): Promise<Found | undefined> {
  const result = await tx.get(conversations.where(field, op, value).limit(1));
  const doc = result.docs[0];
  return doc ? { ref: doc.ref, snapshot: doc } : undefined;
}

/** The thread of the account with this BSUID (current or previous). */
async function threadForUserId(
  tx: Transaction,
  conversations: CollectionReference,
  userId: string
): Promise<Found | undefined> {
  return (
    (await firstMatch(tx, conversations, "userId", "==", userId)) ??
    (await firstMatch(tx, conversations, "previousUserIds", "array-contains", userId))
  );
}

/** Whether a conversation still reaches the customer at this number. */
function usesNumber(data: Record<string, unknown> | undefined, phone: string): boolean {
  return typeof data?.waId === "string" ? data.waId === phone : !includes(data?.previousWaIds, phone);
}

/**
 * The thread that currently uses this number (keyed by it, unless the number
 * has moved on from it, or storing it as waId), and the document keyed by the
 * number whether or not it still uses it.
 */
async function threadForPhone(
  tx: Transaction,
  conversations: CollectionReference,
  phone: string
): Promise<{ owner?: Found; keyed: Found }> {
  const ref = conversations.doc(phone);
  const keyed = { ref, snapshot: await tx.get(ref) };
  if (keyed.snapshot.exists && usesNumber(keyed.snapshot.data(), phone)) {
    return { owner: keyed, keyed };
  }
  return { owner: await firstMatch(tx, conversations, "waId", "==", phone), keyed };
}

type Resolution = {
  conversation: Found;
  /** Another account's thread that used this number until now (the number was reassigned). */
  displaced?: Found;
};

type CustomerIds = {
  phone?: string;
  senderUserId?: string;
  /** From an identity-change notice. */
  previousUserId?: string;
  newUserId?: string;
  isSystem: boolean;
};

/**
 * Where an inbound event goes. Reads only, so it can run first in a
 * transaction. Old ids come before new ones, so a change notice lands in the
 * thread the customer is leaving.
 *  1. The thread that knows the sender's BSUID (or a notice's previous BSUID),
 *     as current or previous BSUID.
 *  2. The thread that currently uses `phone`, unless both it and the sender
 *     have BSUIDs and they differ: then the number now belongs to a different
 *     WhatsApp account, which gets its own thread.
 *  3. The thread that knows a notice's new BSUID.
 *  4. A new thread under the number, or under the BSUID if the number's id
 *     is taken.
 */
async function resolveConversation(
  tx: Transaction,
  conversations: CollectionReference,
  ids: CustomerIds
): Promise<Resolution> {
  for (const userId of new Set([ids.senderUserId, ids.previousUserId])) {
    if (!userId) continue;
    const found = await threadForUserId(tx, conversations, userId);
    if (found) return { conversation: found };
  }

  let displaced: Found | undefined;
  let keyed: Found | undefined;
  if (ids.phone) {
    const byPhone = await threadForPhone(tx, conversations, ids.phone);
    keyed = byPhone.keyed;
    if (byPhone.owner) {
      const ownerUserId = validUserId(byPhone.owner.snapshot.get("userId"));
      if (ids.isSystem || !ids.senderUserId || !ownerUserId) {
        return { conversation: byPhone.owner };
      }
      displaced = byPhone.owner;
    }
  }

  if (ids.newUserId) {
    const found = await threadForUserId(tx, conversations, ids.newUserId);
    if (found) return { conversation: found, displaced };
  }
  if (keyed && !keyed.snapshot.exists) return { conversation: keyed, displaced };

  const newId = ids.senderUserId ?? ids.newUserId ?? ids.previousUserId;
  if (newId) {
    const ref = conversations.doc(newId);
    return { conversation: { ref, snapshot: await tx.get(ref) }, displaced };
  }
  // Number only, and its id belongs to a thread the number moved away from.
  // Rare (every webhook carries a BSUID since 2026); keep the message there.
  return { conversation: keyed!, displaced };
}

/**
 * For a number/BSUID change notice: a different thread that already belongs
 * to the customer's new identity (their first message from it can arrive
 * before the notice).
 */
async function findSuccessor(
  tx: Transaction,
  conversations: CollectionReference,
  currentId: string,
  change: IdentityChange
): Promise<string | undefined> {
  if (change.newUserId) {
    const found = await threadForUserId(tx, conversations, change.newUserId);
    if (found && found.ref.id !== currentId) return found.ref.id;
  }
  if (change.newWaId) {
    const { owner } = await threadForPhone(tx, conversations, change.newWaId);
    if (owner && owner.ref.id !== currentId) return owner.ref.id;
  }
  return undefined;
}

/**
 * Who the customer is, written with every message: their current number and
 * BSUID, profile, and the changes WhatsApp told us about.
 */
function identityUpdate(params: {
  data: Record<string, unknown> | undefined;
  phone: string | undefined;
  senderUserId: string | undefined;
  profile: ContactProfile | undefined;
  change: IdentityChange;
  successor: string | undefined;
}): Record<string, unknown> {
  const { data, phone, senderUserId, profile, change, successor } = params;
  const update: Record<string, unknown> = {};
  const previousWaIds = new Set<string>();
  const previousUserIds = new Set<string>();

  // A late message from an id the customer has since left mustn't bring it back.
  if (phone && !includes(data?.previousWaIds, phone)) update.waId = phone;
  if (senderUserId && !includes(data?.previousUserIds, senderUserId)) update.userId = senderUserId;
  if (profile?.name) update.name = profile.name;
  if (profile?.username) update.username = profile.username;

  if (change.kind && successor) {
    // They already write from another thread; point there instead of giving
    // this one their new ids (two threads would then share them).
    update.continuedIn = successor;
  } else if (change.kind) {
    const storedWaId = validPhone(data?.waId);
    const storedUserId = validUserId(data?.userId);
    if (change.newWaId) {
      update.waId = change.newWaId;
      for (const old of [phone, storedWaId]) {
        if (old && old !== change.newWaId) previousWaIds.add(old);
      }
    } else if (change.kind === "user_changed_user_id" && !phone && storedWaId) {
      // The BSUID changes with the number; with no shareable new number the
      // old one no longer reaches them.
      update.waId = FieldValue.delete();
      previousWaIds.add(storedWaId);
    }
    if (change.newUserId) {
      update.userId = change.newUserId;
      for (const old of [change.previousUserId, storedUserId, senderUserId]) {
        if (old && old !== change.newUserId) previousUserIds.add(old);
      }
    }
  }

  if (previousWaIds.size) update.previousWaIds = FieldValue.arrayUnion(...previousWaIds);
  if (previousUserIds.size) update.previousUserIds = FieldValue.arrayUnion(...previousUserIds);
  return update;
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
  profile?: ContactProfile
): Promise<void> {
  const phone = validPhone(message.from);
  const senderUserId = validUserId(message.fromUserId);
  const change = identityChange(message);
  const isSystem = message.type === "system";
  const customer: CustomerIds = {
    phone,
    senderUserId,
    previousUserId: change.previousUserId,
    newUserId: change.newUserId,
    isSystem,
  };
  const hasCustomerId = Boolean(phone ?? senderUserId ?? change.previousUserId ?? change.newUserId);

  if (!message.id || !isValidDocumentId(message.id) || !hasCustomerId) {
    // Nothing usable to key it by. Never drop a message silently. (Throwing
    // wouldn't help: Meta's retries would carry the same ids.)
    console.error(
      "[whatsapp/store] inbound message NOT stored (no usable message id or customer id):",
      JSON.stringify({
        wamid: message.id || null,
        type: message.type,
        hasFrom: Boolean(message.from),
        fromUserId: message.fromUserId ?? null,
        systemType: message.content?.type === "system" ? (message.content.systemType ?? null) : null,
      })
    );
    return;
  }

  const db = getAdminFirestore();
  const conversations = db.collection(CONVERSATIONS);
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
    from: phone,
    fromUserId: senderUserId,
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
  // WhatsApp-generated notices (isSystem, e.g. a number change) aren't
  // customer messages, so they don't open or extend the 24h service window.
  const summary = summarizeMessage(message);

  await db.runTransaction(async (tx) => {
    // Transactions must do every read before the first write.
    const { conversation, displaced } = await resolveConversation(tx, conversations, customer);
    const convRef = conversation.ref;
    const msgRef = convRef.collection(MESSAGES).doc(message.id);
    const existing = await tx.get(msgRef);
    const sameTarget = reaction
      ? await tx.get(
          convRef.collection(MESSAGES).where("content.messageId", "==", reaction.messageId)
        )
      : undefined;
    const successor = change.kind
      ? await findSuccessor(tx, conversations, convRef.id, change)
      : undefined;
    if (existing.exists) return; // already stored — idempotent no-op

    tx.set(msgRef, messageDoc);
    const data = conversation.snapshot.data();

    if (displaced && phone) {
      // The number now belongs to someone else: the earlier holder's thread
      // must stop sending to it.
      tx.set(
        displaced.ref,
        {
          waId: FieldValue.delete(),
          previousWaIds: FieldValue.arrayUnion(phone),
          numberReassignedAt: ts,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

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

    const identity = identityUpdate({ data, phone, senderUserId, profile, change, successor });

    // Meta doesn't guarantee delivery order, and retried events arrive late.
    // Only an event at least as recent as the conversation's latest message
    // (to the second; Meta's timestamps have no milliseconds) may replace the
    // preview.
    const latestMs = timestampMillis(data?.lastMessageAt);
    const isLatest =
      latestMs === undefined ||
      Math.floor(ts.toMillis() / 1000) >= Math.floor(latestMs / 1000);

    // The reply window runs 24h from the customer's most recent message, so a
    // late event can extend it but never shorten it.
    const windowMs = timestampMillis(data?.serviceWindowExpiresAt);
    const windowUpdate =
      !isSystem && (windowMs === undefined || windowExpires.toMillis() > windowMs)
        ? { serviceWindowExpiresAt: windowExpires }
        : {};

    // Whether the preview currently shows a reaction to the same message.
    const showsThisReaction =
      !!reaction &&
      data?.lastMessageType === "reaction" &&
      data.lastReactionTargetId === reaction.messageId;

    if (reaction) {
      // A reaction older than a later reaction to the same message, or than
      // the conversation's latest message, only goes in the history.
      const superseded = sameTarget?.docs.some(
        (doc) => doc.id !== message.id && isLaterThan(doc.get("timestamp"), ts)
      );
      if (superseded || !isLatest) return;

      if (!reaction.emoji) {
        // Removal: undo the reaction's preview, and its unread count if that
        // hasn't been read yet (reactionUnread is cleared by mark-read).
        if (showsThisReaction) {
          const unread = typeof data?.unreadCount === "number" ? data.unreadCount : 0;
          tx.set(
            convRef,
            {
              lastMessageText: summary,
              lastReactionTargetId: FieldValue.delete(),
              ...(data?.reactionUnread === true
                ? { unreadCount: Math.max(0, unread - 1), reactionUnread: FieldValue.delete() }
                : {}),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        return;
      }
    } else if (!isLatest) {
      // A late message: it's unread and may extend the reply window, but the
      // preview stays on the newer message.
      tx.set(
        convRef,
        {
          ...identity,
          ...windowUpdate,
          unreadCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return;
    }

    // Unread: a reaction counts once (a changed emoji replaces it) and is
    // marked so its removal can take it back; anything else counts and
    // ends that.
    const unreadUpdate = reaction
      ? showsThisReaction
        ? {}
        : { unreadCount: FieldValue.increment(1), reactionUnread: true }
      : { unreadCount: FieldValue.increment(1), reactionUnread: FieldValue.delete() };

    tx.set(
      convRef,
      {
        ...identity,
        lastMessageId: message.id,
        lastMessageText: summary,
        lastMessageType: message.type,
        lastMessageAt: ts,
        lastDirection: "in",
        lastReactionTargetId: reaction?.messageId ?? FieldValue.delete(),
        ...windowUpdate,
        ...unreadUpdate,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

/**
 * Media details of an inbound message, or null if the message doesn't exist,
 * isn't inbound, or has no media. The media route uses this so it only ever
 * downloads media a customer actually sent to this inbox.
 */
export async function getInboundMedia(
  conversationId: string,
  wamid: string
): Promise<MediaContent | null> {
  const snap = await getAdminFirestore()
    .collection(CONVERSATIONS)
    .doc(conversationId)
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

/** Where a reply to a conversation goes, or why it can't be sent. */
export type ReplyTarget =
  | { ok: true; recipient: WhatsAppRecipient }
  | { ok: false; error: string };

/**
 * The customer's current number, else their current BSUID, else the
 * conversation id (unless that number has moved on). Null if there's no
 * such conversation.
 */
export async function getConversationRecipient(
  conversationId: string
): Promise<ReplyTarget | null> {
  if (!isConversationId(conversationId)) return null;
  const snap = await getAdminFirestore().collection(CONVERSATIONS).doc(conversationId).get();
  if (!snap.exists) return null;
  if (typeof snap.get("continuedIn") === "string") {
    return {
      ok: false,
      error: "This customer changed their number and now writes from another conversation. Reply there.",
    };
  }
  const waId = validPhone(snap.get("waId"));
  if (waId) return { ok: true, recipient: { kind: "phone", digits: waId } };
  const userId = validUserId(snap.get("userId"));
  if (userId) return { ok: true, recipient: { kind: "user", userId } };
  if (isUserId(conversationId)) {
    return { ok: true, recipient: { kind: "user", userId: conversationId } };
  }
  if (usesNumber(snap.data(), conversationId)) {
    return { ok: true, recipient: { kind: "phone", digits: conversationId } };
  }
  return {
    ok: false,
    error: "This customer's number now belongs to someone else, and there's no other way to reach them.",
  };
}

/**
 * The conversation for a message sent to a typed number or BSUID: the thread
 * that currently uses it, else a new one. `userIdHint` is the BSUID Meta
 * returned for a number, used when the number's id is taken by an earlier
 * holder's thread.
 */
async function outboundConversation(
  conversations: CollectionReference,
  customerId: string,
  userIdHint?: string
): Promise<{ ref: DocumentReference; exists: boolean }> {
  if (isUserId(customerId)) {
    const match =
      (await conversations.where("userId", "==", customerId).limit(1).get()).docs[0] ??
      (await conversations.where("previousUserIds", "array-contains", customerId).limit(1).get())
        .docs[0];
    if (match) return { ref: match.ref, exists: true };
    const ref = conversations.doc(customerId);
    return { ref, exists: (await ref.get()).exists };
  }

  const owner = (await conversations.where("waId", "==", customerId).limit(1).get()).docs[0];
  if (owner) return { ref: owner.ref, exists: true };
  const ref = conversations.doc(customerId);
  const keyed = await ref.get();
  if (!keyed.exists || usesNumber(keyed.data(), customerId)) return { ref, exists: keyed.exists };
  // The number's id belongs to an earlier holder's thread.
  if (userIdHint) return outboundConversation(conversations, userIdHint);
  return { ref, exists: true };
}

/**
 * Persist a message we just sent via the Cloud API so the thread shows both
 * sides. A later `statuses` webhook upgrades `status` (sent → delivered → read).
 */
export async function recordOutboundMessage(params: {
  wamid: string;
  /** A conversation id (with `exact`), or the wa_id / BSUID the message went to. */
  conversationId: string;
  /** Store in exactly this conversation (a reply from the inbox). */
  exact?: boolean;
  /** For a message to a number: the BSUID Meta returned for it, if any. */
  userIdHint?: string;
  type: string;
  text?: string;
  /** Firebase uid of the operator who sent it. */
  sentBy?: string;
}): Promise<void> {
  const { wamid, conversationId, exact, type, text, sentBy } = params;
  if (!wamid || !isValidDocumentId(wamid) || !isConversationId(conversationId)) return;
  const userIdHint = validUserId(params.userIdHint);

  const db = getAdminFirestore();
  const conversations = db.collection(CONVERSATIONS);
  const target = exact
    ? { ref: conversations.doc(conversationId), exists: true }
    : await outboundConversation(conversations, conversationId, userIdHint);
  const msgRef = target.ref.collection(MESSAGES).doc(wamid);
  const now = Timestamp.now();

  const batch = db.batch();
  batch.set(
    msgRef,
    {
      id: wamid,
      direction: "out",
      type,
      text: text ?? null,
      to: conversationId,
      ...(sentBy ? { sentBy } : {}),
      status: "sent",
      timestamp: now,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  batch.set(
    target.ref,
    {
      // A new conversation learns the customer's ids; an existing one keeps
      // whatever the webhook last recorded.
      ...(target.exists
        ? {}
        : isPhoneId(conversationId)
          ? { waId: conversationId, ...(userIdHint ? { userId: userIdHint } : {}) }
          : { userId: conversationId }),
      lastMessageId: wamid,
      lastMessageText: text ?? `[${type}]`,
      lastMessageType: type,
      lastMessageAt: now,
      lastDirection: "out",
      lastReactionTargetId: FieldValue.delete(),
      reactionUnread: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await batch.commit();
}

/** Clear a conversation's unread counter (called when an operator opens it). */
export async function markConversationRead(conversationId: string): Promise<void> {
  if (!isConversationId(conversationId)) return;
  const db = getAdminFirestore();
  await db
    .collection(CONVERSATIONS)
    .doc(conversationId)
    .set(
      {
        unreadCount: 0,
        reactionUnread: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
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
 * The stored outbound message a status update is about. Statuses name the
 * customer by number, by BSUID, or both, and the conversation may be keyed
 * by either (or by an id the customer has since left).
 */
async function findOutboundMessage(
  tx: Transaction,
  conversations: CollectionReference,
  status: StatusUpdate
): Promise<DocumentSnapshot | undefined> {
  const checked = new Set<string>();
  const tryThread = async (ref: DocumentReference) => {
    if (checked.has(ref.id)) return undefined;
    checked.add(ref.id);
    const snap = await tx.get(ref.collection(MESSAGES).doc(status.id));
    return snap.exists ? snap : undefined;
  };
  for (const id of [status.recipientId, status.recipientUserId]) {
    if (!id || !isConversationId(id)) continue;
    const found = await tryThread(conversations.doc(id));
    if (found) return found;
  }
  const userId = validUserId(status.recipientUserId);
  if (userId) {
    const thread = await threadForUserId(tx, conversations, userId);
    const found = thread && (await tryThread(thread.ref));
    if (found) return found;
  }
  const phone = validPhone(status.recipientId);
  if (phone) {
    const thread = await firstMatch(tx, conversations, "waId", "==", phone);
    const found = thread && (await tryThread(thread.ref));
    if (found) return found;
  }
  return undefined;
}

/**
 * Apply a delivery-status webhook to the matching outbound message. Only moves
 * status forward (sent → delivered → read) so out-of-order retries can't
 * regress a "read" back to "delivered". `failed` always wins.
 *
 * Throws RetryLaterError for a recent status whose message isn't stored yet:
 * the send route stores a message right after Meta accepts it, so its first
 * status can win the race. Older unknown statuses are for messages sent
 * outside this app and are ignored.
 */
export async function recordStatusUpdate(status: StatusUpdate): Promise<void> {
  if (!status.id || !isValidDocumentId(status.id) || !status.status) return;
  if (!status.recipientId && !status.recipientUserId) return;

  const db = getAdminFirestore();
  const conversations = db.collection(CONVERSATIONS);

  const found = await db.runTransaction(async (tx) => {
    const snap = await findOutboundMessage(tx, conversations, status);
    if (!snap) return false;

    const current = (snap.data()?.status as string | undefined) ?? "sent";
    const incoming = status.status;
    const isFailure = incoming === "failed";
    // Own-property lookups: unknown values (including "__proto__") rank 0 and are ignored.
    const rank = (s: string) => (Object.hasOwn(STATUS_RANK, s) ? STATUS_RANK[s] : 0);
    if (!isFailure && rank(incoming) <= rank(current)) {
      return true;
    }

    tx.set(
      snap.ref,
      {
        status: incoming,
        statusAt: secondsStringToTimestamp(status.timestamp),
        ...(status.errorTitle ? { errorTitle: status.errorTitle } : {}),
        ...(status.errorCode != null ? { errorCode: status.errorCode } : {}),
      },
      { merge: true }
    );
    return true;
  });

  if (!found) {
    const at = Number(status.timestamp) * 1000;
    if (Number.isFinite(at) && at > 0 && Date.now() - at < STATUS_RETRY_WINDOW_MS) {
      throw new RetryLaterError(
        `"${status.status}" status for ${status.id} arrived before the message was stored`
      );
    }
  }
}
