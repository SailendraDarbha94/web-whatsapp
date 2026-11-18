/*
 * Customer ids. A conversation is keyed by the customer's WhatsApp phone
 * number (wa_id: country code + number, digits only) or, for customers who
 * use a WhatsApp username and haven't shared their number, by their
 * business-scoped user id (BSUID), e.g. "US.13491208655302741918".
 * Shared by the browser and the server, so this file has no imports.
 */

const PHONE_ID = /^\d{5,20}$/;
const USER_ID = /^[A-Z]{2,3}\.[A-Za-z0-9._-]{1,156}$/;

/** A wa_id: the customer's phone number as digits, with country code. */
export function isPhoneId(id: string): boolean {
  return PHONE_ID.test(id);
}

/** A business-scoped user id (BSUID). */
export function isUserId(id: string): boolean {
  return USER_ID.test(id);
}

/** Either kind of customer id, i.e. a valid conversation document id. */
export function isConversationId(id: string): boolean {
  return isPhoneId(id) || isUserId(id);
}

/** Firestore document ids can't contain "/", be "." or "..", or look like __x__. */
export function isValidDocumentId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= 512 &&
    !id.includes("/") &&
    id !== "." &&
    id !== ".." &&
    !/^__.*__$/.test(id)
  );
}

type CustomerFields = {
  /** Conversation id (wa_id or BSUID). */
  id: string;
  name?: unknown;
  username?: unknown;
  /** The customer's current number (it can differ from the id after a number change). */
  waId?: unknown;
  /** Numbers the customer no longer uses. */
  previousWaIds?: unknown;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** The customer's current number: the stored one, else the id unless they've left it. */
function phoneOf(c: CustomerFields): string | undefined {
  const waId = text(c.waId);
  if (waId && isPhoneId(waId)) return waId;
  const left = Array.isArray(c.previousWaIds) && c.previousWaIds.includes(c.id);
  return isPhoneId(c.id) && !left ? c.id : undefined;
}

/** How to refer to a customer: profile name, else username, else number. */
export function customerLabel(c: CustomerFields): string {
  const name = text(c.name);
  if (name) return name;
  const username = text(c.username);
  if (username) return `@${username}`;
  const phone = phoneOf(c);
  return phone ? `+${phone}` : "WhatsApp user";
}

/** Secondary line under the name: the number, or that it wasn't shared. */
export function customerDetail(c: CustomerFields): string {
  const phone = phoneOf(c);
  if (phone) return `+${phone}`;
  const username = text(c.username);
  return username ? `@${username} · number not shared` : "Number not shared";
}
