/**
 * Shapes for the non-text content of WhatsApp messages, as stored on
 * conversations/{waId}/messages/{wamid}. Shared by the server (the webhook
 * normalizes Meta's payload into these in src/lib/whatsapp/webhook.ts) and the
 * browser (the inbox renders them), so this module must stay free of imports.
 *
 * Field names are camelCased versions of Meta's. Optional fields are omitted
 * (never `undefined`) in stored documents.
 */

export const MEDIA_TYPES = [
  "image",
  "video",
  "audio",
  "document",
  "sticker",
] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];

export function isMediaType(value: string): value is MediaType {
  return (MEDIA_TYPES as readonly string[]).includes(value);
}

/**
 * How long Meta keeps inbound media downloadable by id: 7 days since
 * 2025-10-09 (it was 30). After that the media is gone unless it was saved.
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media
 */
export const MEDIA_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type MediaContent = {
  type: MediaType;
  /** Meta media id. Resolve it through /api/whatsapp/media, never in the browser. */
  mediaId: string;
  mimeType?: string;
  caption?: string;
  /** Documents only. */
  filename?: string;
  /** Audio only: true for voice notes recorded in WhatsApp. */
  voice?: boolean;
  /** Stickers only. */
  animated?: boolean;
};

export type LocationContent = {
  type: "location";
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
  url?: string;
};

export type SharedContactPhone = {
  phone?: string;
  /** Set when the number is on WhatsApp. */
  waId?: string;
  type?: string;
};

export type SharedContact = {
  name: string;
  phones: SharedContactPhone[];
  emails: string[];
  organization?: string;
};

export type ContactsContent = {
  type: "contacts";
  contacts: SharedContact[];
};

/** The customer tapped a quick-reply button on a template message. */
export type ButtonContent = {
  type: "button";
  text?: string;
  payload?: string;
};

export type InteractiveContent = {
  type: "interactive";
  /**
   * "button_reply", "list_reply", "product", "nfm_reply" (WhatsApp Flows and
   * address messages), "call_permission_reply", or a newer kind.
   */
  replyType: string;
  /** button_reply / list_reply: the chosen id; product: the retailer id. */
  replyId?: string;
  title?: string;
  description?: string;
  /** product only, in currency units (Meta sends thousandths). */
  price?: number;
  salePrice?: number;
  currency?: string;
  /** nfm_reply only: "flow" or "address_message". */
  flowName?: string;
  /** nfm_reply only: "Sent" for Flows, the address text for address messages. */
  flowBody?: string;
  /** nfm_reply only: the submitted data, as the JSON string Meta sends. */
  flowResponseJson?: string;
  /** call_permission_reply only: "accept" or "reject". */
  callPermission?: string;
};

export type ReactionContent = {
  type: "reaction";
  /** wamid of the message being reacted to. */
  messageId: string;
  /** Absent when the customer removed their reaction. */
  emoji?: string;
};

export type OrderItem = {
  productRetailerId?: string;
  quantity?: number;
  itemPrice?: number;
  currency?: string;
};

export type OrderContent = {
  type: "order";
  catalogId?: string;
  text?: string;
  items: OrderItem[];
};

export type SystemContent = {
  type: "system";
  /** e.g. "user_changed_number" or "user_changed_user_id". */
  systemType?: string;
  body?: string;
  /** user_changed_number: the customer's new WhatsApp id. */
  newWaId?: string;
};

/** Something WhatsApp can't deliver through the API, e.g. a poll. */
export type UnsupportedContent = {
  type: "unsupported";
  /** What the customer sent, e.g. "poll_creation" or "edit". */
  originalType: string;
};

/** The customer edited an earlier message (WhatsApp Business app numbers only). */
export type EditContent = {
  type: "edit";
  originalMessageId: string;
  /** The new text, when a text message was edited. */
  text?: string;
  /** The new media object, when a caption was edited. */
  content?: MediaContent;
};

/** The customer deleted an earlier message (WhatsApp Business app numbers only). */
export type RevokeContent = {
  type: "revoke";
  originalMessageId: string;
};

export type MessageContent =
  | MediaContent
  | LocationContent
  | ContactsContent
  | ButtonContent
  | InteractiveContent
  | ReactionContent
  | OrderContent
  | SystemContent
  | UnsupportedContent
  | EditContent
  | RevokeContent;

export function isMediaContent(
  content: MessageContent | null | undefined
): content is MediaContent {
  return !!content && isMediaType(content.type);
}

/** Present when the message replies to, or forwards, another message. */
export type MessageContext = {
  /** wamid of the message being replied to. */
  messageId?: string;
  from?: string;
  forwarded?: boolean;
  frequentlyForwarded?: boolean;
  /** Set when the customer asked about a catalog product. */
  referredProduct?: {
    catalogId?: string;
    productRetailerId?: string;
  };
};

/** Present when the customer arrived from a click-to-WhatsApp ad or post. */
export type MessageReferral = {
  sourceType?: string;
  sourceId?: string;
  sourceUrl?: string;
  headline?: string;
  body?: string;
  mediaType?: string;
  ctwaClid?: string;
};

/** Present on messages WhatsApp couldn't deliver as content (type "unsupported"). */
export type MessageError = {
  code?: number;
  title?: string;
  message?: string;
  details?: string;
};

export type SummarizableMessage = {
  type: string;
  text?: string | null;
  content?: MessageContent | null;
  errors?: MessageError[] | null;
};

/** Labels used when a message carries no stored content (e.g. older documents). */
const TYPE_LABELS: Record<string, string> = {
  image: "📷 Photo",
  video: "🎥 Video",
  audio: "🎵 Audio",
  document: "📄 Document",
  sticker: "Sticker",
  location: "📍 Location",
  contacts: "👤 Contact",
  button: "Button reply",
  interactive: "Interactive reply",
  reaction: "Reaction",
  order: "🛒 Order",
  system: "System message",
  edit: "✏️ Edited a message",
  revoke: "🚫 Deleted a message",
  request_welcome: "Opened the chat",
};

/**
 * Own-property lookup. `type` comes from the payload, so a plain `table[type]`
 * would return inherited members for keys like "__proto__" or "constructor".
 */
export function lookupLabel(
  table: Record<string, string>,
  key: string
): string | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * One-line, human-readable version of a message, used for the conversation
 * preview and wherever a message has to be quoted. Always returns a string.
 */
export function summarizeMessage(message: SummarizableMessage): string {
  if (typeof message.text === "string" && message.text) return message.text;

  const content = message.content;
  if (content) {
    switch (content.type) {
      case "image":
        return content.caption ? `📷 ${content.caption}` : "📷 Photo";
      case "video":
        return content.caption ? `🎥 ${content.caption}` : "🎥 Video";
      case "audio":
        return content.voice ? "🎤 Voice message" : "🎵 Audio";
      case "document":
        return `📄 ${content.filename ?? content.caption ?? "Document"}`;
      case "sticker":
        return "Sticker";
      case "location":
        return `📍 ${content.name ?? content.address ?? "Location"}`;
      case "contacts": {
        const [first, ...rest] = content.contacts;
        const name = first?.name ?? "Contact";
        return rest.length > 0 ? `👤 ${name} +${rest.length} more` : `👤 ${name}`;
      }
      case "button":
        return content.text ?? content.payload ?? "Button reply";
      case "interactive":
        if (content.replyType === "call_permission_reply") {
          if (content.callPermission === "accept") return "📞 Allowed calls";
          if (content.callPermission === "reject") return "📞 Declined calls";
          return "📞 Call permission reply";
        }
        return (
          content.title ??
          content.flowBody ??
          (content.replyType === "nfm_reply" ? "Form response" : "Interactive reply")
        );
      case "reaction":
        return content.emoji ? `Reacted ${content.emoji}` : "Removed a reaction";
      case "order": {
        const count = content.items.length;
        return `🛒 Order · ${count} item${count === 1 ? "" : "s"}`;
      }
      case "system":
        return content.body ?? "System message";
      case "unsupported":
        return `Unsupported message (${content.originalType.replace(/_/g, " ")})`;
      case "edit":
        if (content.text) return `✏️ ${content.text}`;
        if (content.content) {
          return `✏️ ${summarizeMessage({ type: content.content.type, content: content.content })}`;
        }
        return "✏️ Edited a message";
      case "revoke":
        return "🚫 Deleted a message";
    }
  }

  if (message.type === "unsupported" || message.type === "unknown") {
    const title = message.errors?.[0]?.title;
    return title ? `Unsupported message: ${title}` : "Unsupported message";
  }

  return lookupLabel(TYPE_LABELS, message.type) ?? `[${message.type}]`;
}

/**
 * Return `raw` only if it is an absolute http(s) URL. Use this before putting
 * any customer- or Meta-supplied URL into an href.
 */
export function safeExternalUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function mapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}
