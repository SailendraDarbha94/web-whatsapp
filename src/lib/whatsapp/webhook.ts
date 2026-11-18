import { createHmac, timingSafeEqual } from "node:crypto";
import {
  isMediaType,
  type MediaContent,
  type MediaType,
  type MessageContent,
  type MessageContext,
  type MessageError,
  type MessageReferral,
  type OrderItem,
  type SharedContact,
  type SharedContactPhone,
} from "@/lib/whatsapp/message-content";

export type InboundMessage = {
  /**
   * Customer's WhatsApp id (phone digits). Meta omits it for customers who use
   * a username and haven't shared their number; then only fromUserId is set.
   */
  from: string;
  /** Business-scoped user id (BSUID), e.g. "US.13491208655302741918". */
  fromUserId?: string;
  id: string;
  timestamp: string;
  type: string;
  text?: string;
  /** Normalized type-specific content (media, location, button tap, …). */
  content?: MessageContent;
  /** Reply / forward information. */
  context?: MessageContext;
  /** Click-to-WhatsApp ad or post the customer came from. */
  referral?: MessageReferral;
  /** Why WhatsApp couldn't deliver the content (type "unsupported"). */
  errors?: MessageError[];
  /** Original message object, kept so nothing Meta sends is lost. */
  raw: Record<string, unknown>;
};

export type StatusUpdate = {
  id: string;
  status: string;
  timestamp: string;
  /** Customer's wa_id; omitted for customers who haven't shared their number. */
  recipientId?: string;
  /** Customer's business-scoped user id (BSUID). */
  recipientUserId?: string;
  errorTitle?: string;
  errorCode?: number;
  raw: Record<string, unknown>;
};

/** What the payload's `contacts` say about a customer. */
export type ContactProfile = { name?: string; username?: string };

export type ParsedMessagesPayload = {
  inbound: InboundMessage[];
  statuses: StatusUpdate[];
  /** Profiles from the payload's `contacts`, by wa_id and by BSUID. */
  contacts: Map<string, ContactProfile>;
};

/** The profile Meta sent along with a message, looked up by number, then by BSUID. */
export function profileFor(
  contacts: Map<string, ContactProfile>,
  message: Pick<InboundMessage, "from" | "fromUserId">
): ContactProfile | undefined {
  return (
    (message.from ? contacts.get(message.from) : undefined) ??
    (message.fromUserId ? contacts.get(message.fromUserId) : undefined)
  );
}

/**
 * Verify Meta's X-Hub-Signature-256 header against the raw request body.
 * `signatureHeader` looks like "sha256=<hex>". Returns true when it matches
 * an HMAC-SHA256 of the raw body keyed with the app secret.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;

  const provided = signatureHeader.slice("sha256=".length).trim();
  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

type GraphChangeValue = {
  messaging_product?: string;
  metadata?: Record<string, unknown>;
  contacts?: unknown;
  messages?: unknown;
  statuses?: unknown;
};

type GraphWebhookBody = {
  object?: string;
  entry?: unknown;
};

/** Pull inbound messages and status updates out of a `messages`-field payload. */
export function parseMessagesPayload(body: unknown): ParsedMessagesPayload {
  const inbound: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  const contacts = new Map<string, ContactProfile>();

  // External input: skip anything that isn't shaped as documented instead of
  // throwing, so one malformed item can't drop the rest of the payload.
  const typed = (rec(body) ?? {}) as GraphWebhookBody;
  for (const entry of list(typed.entry).map(rec)) {
    for (const change of list(entry?.changes).map(rec)) {
      if (!change || change.field !== "messages") continue;
      const value = rec(change.value) as GraphChangeValue | undefined;
      if (!value) continue;

      for (const c of records(value.contacts)) {
        const profile = rec(c.profile);
        const details = defined({
          name: str(profile?.name),
          username: str(profile?.username),
        });
        if (!hasFields(details)) continue;
        const waId = str(c.wa_id);
        const userId = str(c.user_id);
        if (waId) contacts.set(waId, details);
        if (userId) contacts.set(userId, details);
      }

      for (const m of records(value.messages)) {
        const type = String(m.type ?? "unknown");
        const text =
          type === "text" && isRecord(m.text)
            ? String((m.text as Record<string, unknown>).body ?? "")
            : undefined;
        inbound.push({
          from: String(m.from ?? ""),
          fromUserId: str(m.from_user_id),
          id: String(m.id ?? ""),
          timestamp: String(m.timestamp ?? ""),
          type,
          text,
          content: normalizeContent(type, m),
          context: normalizeContext(m.context),
          referral: normalizeReferral(m.referral),
          errors: normalizeErrors(m.errors),
          raw: m,
        });
      }

      for (const s of records(value.statuses)) {
        const errors = Array.isArray(s.errors)
          ? (s.errors as Array<Record<string, unknown>>)
          : [];
        const firstError = errors[0];
        statuses.push({
          id: String(s.id ?? ""),
          status: String(s.status ?? ""),
          timestamp: String(s.timestamp ?? ""),
          recipientId: str(s.recipient_id),
          recipientUserId: str(s.recipient_user_id),
          errorTitle: firstError
            ? String(firstError.title ?? firstError.message ?? "")
            : undefined,
          errorCode:
            firstError && typeof firstError.code === "number"
              ? (firstError.code as number)
              : undefined,
          raw: s,
        });
      }
    }
  }

  return { inbound, statuses, contacts };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/*
 * Normalizers: turn Meta's per-type message objects into the shapes in
 * message-content.ts. They read defensively (the payload is external input)
 * and leave out anything missing, so results never contain `undefined`
 * values worth storing.
 */

function rec(v: unknown): Record<string, unknown> | undefined {
  return isRecord(v) && !Array.isArray(v) ? v : undefined;
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** The plain-object items of an array, skipping anything else. */
function records(v: unknown): Record<string, unknown>[] {
  return list(v).filter((item): item is Record<string, unknown> => rec(item) !== undefined);
}

/** Non-empty string (numbers are stringified), else undefined. */
function str(v: unknown): string | undefined {
  if (typeof v === "string") return v.length > 0 ? v : undefined;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

/** Finite number (numeric strings are accepted), else undefined. */
function num(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** Drop keys whose value is undefined (shallow). */
function defined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as T;
}

function hasFields(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).length > 0;
}

/** Meta sends catalog prices in thousandths (1.00 USD = 1000). */
function fromThousandths(v: unknown): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : n / 1000;
}

function normalizeMedia(
  type: MediaType,
  m: Record<string, unknown>
): MediaContent | undefined {
  const media = rec(m[type]);
  const mediaId = str(media?.id);
  if (!media || !mediaId) return undefined;
  return defined({
    type,
    mediaId,
    mimeType: str(media.mime_type),
    caption: str(media.caption),
    filename: type === "document" ? str(media.filename) : undefined,
    voice: type === "audio" ? bool(media.voice) : undefined,
    animated: type === "sticker" ? bool(media.animated) : undefined,
  });
}

function normalizeContent(
  type: string,
  m: Record<string, unknown>
): MessageContent | undefined {
  if (isMediaType(type)) return normalizeMedia(type, m);

  switch (type) {
    case "location": {
      const loc = rec(m.location);
      const latitude = num(loc?.latitude);
      const longitude = num(loc?.longitude);
      if (!loc || latitude === undefined || longitude === undefined) return undefined;
      return defined({
        type: "location" as const,
        latitude,
        longitude,
        name: str(loc.name),
        address: str(loc.address),
        url: str(loc.url),
      });
    }

    case "contacts": {
      const contacts = list(m.contacts)
        .map(normalizeSharedContact)
        .filter((c): c is SharedContact => c !== undefined);
      return contacts.length > 0 ? { type: "contacts", contacts } : undefined;
    }

    case "button": {
      const button = rec(m.button);
      const text = str(button?.text);
      const payload = str(button?.payload);
      if (!text && !payload) return undefined;
      return defined({ type: "button" as const, text, payload });
    }

    case "interactive": {
      const interactive = rec(m.interactive);
      if (!interactive) return undefined;
      const replyType = str(interactive.type) ?? "unknown";
      const reply = rec(interactive[replyType]);
      if (replyType === "product") {
        return defined({
          type: "interactive" as const,
          replyType,
          replyId: str(reply?.retailer_id),
          title: str(reply?.title),
          description: str(reply?.description),
          price: fromThousandths(reply?.price_amount),
          salePrice: fromThousandths(reply?.sale_price_amount),
          currency: str(reply?.currency_code),
        });
      }
      if (replyType === "call_permission_reply") {
        return defined({
          type: "interactive" as const,
          replyType,
          callPermission: str(reply?.response),
        });
      }
      if (replyType === "nfm_reply") {
        return defined({
          type: "interactive" as const,
          replyType,
          flowName: str(reply?.name),
          flowBody: str(reply?.body),
          flowResponseJson: str(reply?.response_json),
        });
      }
      return defined({
        type: "interactive" as const,
        replyType,
        replyId: str(reply?.id),
        title: str(reply?.title),
        description: str(reply?.description),
      });
    }

    case "reaction": {
      const reaction = rec(m.reaction);
      const messageId = str(reaction?.message_id);
      if (!messageId) return undefined;
      // Meta omits the emoji (or sends it empty) when a reaction is removed.
      return defined({
        type: "reaction" as const,
        messageId,
        emoji: str(reaction?.emoji),
      });
    }

    case "order": {
      const order = rec(m.order);
      if (!order) return undefined;
      const items = list(order.product_items)
        .map((item): OrderItem | undefined => {
          const r = rec(item);
          if (!r) return undefined;
          const normalized = defined({
            productRetailerId: str(r.product_retailer_id),
            quantity: num(r.quantity),
            itemPrice: num(r.item_price),
            currency: str(r.currency),
          });
          return hasFields(normalized) ? normalized : undefined;
        })
        .filter((item): item is OrderItem => item !== undefined);
      return defined({
        type: "order" as const,
        catalogId: str(order.catalog_id),
        text: str(order.text),
        items,
      });
    }

    case "system": {
      const system = rec(m.system);
      if (!system) return undefined;
      return defined({
        type: "system" as const,
        systemType: str(system.type),
        body: str(system.body),
        newWaId: str(system.new_wa_id) ?? str(system.wa_id),
        userId: str(system.user_id),
        previousUserId: str(system.previous_user_id),
      });
    }

    case "unsupported": {
      const originalType = str(rec(m.unsupported)?.type);
      return originalType ? { type: "unsupported", originalType } : undefined;
    }

    // edit / revoke are only sent for WhatsApp Business app (Coexistence) numbers.
    case "edit": {
      const edit = rec(m.edit);
      const originalMessageId = str(edit?.original_message_id);
      if (!edit || !originalMessageId) return undefined;
      const edited = rec(edit.message);
      const editedType = str(edited?.type);
      return defined({
        type: "edit" as const,
        originalMessageId,
        text: editedType === "text" ? str(rec(edited?.text)?.body) : undefined,
        content:
          edited && editedType && isMediaType(editedType)
            ? normalizeMedia(editedType, edited)
            : undefined,
      });
    }

    case "revoke": {
      const originalMessageId = str(rec(m.revoke)?.original_message_id);
      return originalMessageId ? { type: "revoke", originalMessageId } : undefined;
    }

    default:
      return undefined;
  }
}

function normalizeSharedContact(value: unknown): SharedContact | undefined {
  const contact = rec(value);
  if (!contact) return undefined;

  const phones = list(contact.phones)
    .map((p): SharedContactPhone | undefined => {
      const r = rec(p);
      if (!r) return undefined;
      const phone = defined({
        phone: str(r.phone),
        waId: str(r.wa_id),
        type: str(r.type),
      });
      return phone.phone || phone.waId ? phone : undefined;
    })
    .filter((p): p is SharedContactPhone => p !== undefined);

  const emails = list(contact.emails)
    .map((e) => str(rec(e)?.email))
    .filter((e): e is string => e !== undefined);

  const nameObj = rec(contact.name);
  const joinedName = [str(nameObj?.first_name), str(nameObj?.last_name)]
    .filter(Boolean)
    .join(" ");
  const name =
    str(nameObj?.formatted_name) ||
    joinedName ||
    phones[0]?.phone ||
    emails[0];
  if (!name) return undefined;

  return defined({
    name,
    phones,
    emails,
    organization: str(rec(contact.org)?.company),
  });
}

function normalizeContext(value: unknown): MessageContext | undefined {
  const context = rec(value);
  if (!context) return undefined;
  const product = rec(context.referred_product);
  const referredProduct = product
    ? defined({
        catalogId: str(product.catalog_id),
        productRetailerId: str(product.product_retailer_id),
      })
    : undefined;
  const normalized = defined({
    messageId: str(context.id),
    from: str(context.from),
    forwarded: bool(context.forwarded),
    frequentlyForwarded: bool(context.frequently_forwarded),
    referredProduct:
      referredProduct && hasFields(referredProduct) ? referredProduct : undefined,
  });
  return hasFields(normalized) ? normalized : undefined;
}

function normalizeReferral(value: unknown): MessageReferral | undefined {
  const referral = rec(value);
  if (!referral) return undefined;
  const normalized = defined({
    sourceType: str(referral.source_type),
    sourceId: str(referral.source_id),
    sourceUrl: str(referral.source_url),
    headline: str(referral.headline),
    body: str(referral.body),
    mediaType: str(referral.media_type),
    ctwaClid: str(referral.ctwa_clid),
  });
  return hasFields(normalized) ? normalized : undefined;
}

function normalizeErrors(value: unknown): MessageError[] | undefined {
  const errors = list(value)
    .map((e): MessageError | undefined => {
      const r = rec(e);
      if (!r) return undefined;
      const normalized = defined({
        code: num(r.code),
        title: str(r.title),
        message: str(r.message),
        details: str(rec(r.error_data)?.details),
      });
      return hasFields(normalized) ? normalized : undefined;
    })
    .filter((e): e is MessageError => e !== undefined);
  return errors.length > 0 ? errors : undefined;
}
