import { createHmac, timingSafeEqual } from "node:crypto";

export type InboundMessage = {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: string;
  /** Original message object for types we don't normalize yet. */
  raw: Record<string, unknown>;
};

export type StatusUpdate = {
  id: string;
  status: string;
  timestamp: string;
  recipientId?: string;
  errorTitle?: string;
  errorCode?: number;
  raw: Record<string, unknown>;
};

export type ParsedMessagesPayload = {
  inbound: InboundMessage[];
  statuses: StatusUpdate[];
  /** Map of wa_id → display name pulled from the payload's `contacts`. */
  contacts: Record<string, string>;
};

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

type GraphWebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: Record<string, unknown>;
        contacts?: Array<Record<string, unknown>>;
        messages?: Array<Record<string, unknown>>;
        statuses?: Array<Record<string, unknown>>;
      };
    }>;
  }>;
};

/** Pull inbound messages and status updates out of a `messages`-field payload. */
export function parseMessagesPayload(body: unknown): ParsedMessagesPayload {
  const inbound: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  const contacts: Record<string, string> = {};

  const typed = body as GraphWebhookBody;
  for (const entry of typed.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value;
      if (!value) continue;

      for (const c of value.contacts ?? []) {
        const waId = c.wa_id != null ? String(c.wa_id) : "";
        const name =
          isRecord(c.profile) && (c.profile as Record<string, unknown>).name
            ? String((c.profile as Record<string, unknown>).name)
            : "";
        if (waId && name) contacts[waId] = name;
      }

      for (const m of value.messages ?? []) {
        const type = String(m.type ?? "unknown");
        const text =
          type === "text" && isRecord(m.text)
            ? String((m.text as Record<string, unknown>).body ?? "")
            : undefined;
        inbound.push({
          from: String(m.from ?? ""),
          id: String(m.id ?? ""),
          timestamp: String(m.timestamp ?? ""),
          type,
          text,
          raw: m,
        });
      }

      for (const s of value.statuses ?? []) {
        const errors = Array.isArray(s.errors)
          ? (s.errors as Array<Record<string, unknown>>)
          : [];
        const firstError = errors[0];
        statuses.push({
          id: String(s.id ?? ""),
          status: String(s.status ?? ""),
          timestamp: String(s.timestamp ?? ""),
          recipientId:
            s.recipient_id != null ? String(s.recipient_id) : undefined,
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
