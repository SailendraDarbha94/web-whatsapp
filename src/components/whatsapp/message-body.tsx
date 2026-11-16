import { MediaAttachment } from "@/components/whatsapp/media-attachment";
import {
  isMediaType,
  lookupLabel,
  mapsUrl,
  safeExternalUrl,
  summarizeMessage,
  type ButtonContent,
  type EditContent,
  type ContactsContent,
  type InteractiveContent,
  type LocationContent,
  type MessageContent,
  type MessageContext,
  type MessageError,
  type MessageReferral,
  type OrderContent,
} from "@/lib/whatsapp/message-content";

/** A message document as the inbox reads it from Firestore. */
export type ThreadMessage = {
  id: string;
  direction: "in" | "out";
  type: string;
  text?: string | null;
  content?: MessageContent | null;
  context?: MessageContext | null;
  referral?: MessageReferral | null;
  errors?: MessageError[] | null;
};

type Props = {
  conversationId: string;
  message: ThreadMessage;
  /** The message this one replies to, when it is in the loaded thread. */
  quoted?: ThreadMessage | null;
  /** How to refer to the customer when quoting their messages. */
  customerLabel: string;
  /** When the message was sent; used to tell whether its media can still be fetched. */
  sentAtMs?: number;
  /** The customer deleted this message (WhatsApp Business app numbers). */
  deleted?: boolean;
};

/** Types that carry content beyond text; used to flag older, content-less documents. */
const CONTENT_TYPES = new Set([
  "location",
  "contacts",
  "button",
  "interactive",
  "reaction",
  "order",
  "system",
  "edit",
  "revoke",
]);

const INTERACTIVE_LABELS: Record<string, string> = {
  button_reply: "Button reply",
  list_reply: "List reply",
  product: "Product",
  nfm_reply: "Form response",
  call_permission_reply: "Call permission",
};

/** The inside of a message bubble: reply/forward/ad context, then the content. */
export function MessageBody({
  conversationId,
  message,
  quoted,
  customerLabel,
  sentAtMs,
  deleted,
}: Props) {
  const { context, referral } = message;
  const forwardedLabel = context?.frequentlyForwarded
    ? "Forwarded many times"
    : context?.forwarded
      ? "Forwarded"
      : null;

  return (
    <div className="space-y-1.5">
      {deleted && (
        <p className="text-[11px] font-medium italic opacity-70">
          🚫 The customer deleted this message
        </p>
      )}
      {forwardedLabel && (
        <p className="text-[11px] italic opacity-70">↪ {forwardedLabel}</p>
      )}
      {context?.referredProduct && (
        <p className="text-[11px] opacity-70">
          🛍 Asked about product{" "}
          {context.referredProduct.productRetailerId ?? "from your catalog"}
        </p>
      )}
      {context?.messageId && !context.referredProduct && (
        <QuotedMessage quoted={quoted ?? null} customerLabel={customerLabel} />
      )}
      {referral && <ReferralCard referral={referral} />}
      <ContentView conversationId={conversationId} message={message} sentAtMs={sentAtMs} />
    </div>
  );
}

function ContentView({
  conversationId,
  message,
  sentAtMs,
}: {
  conversationId: string;
  message: ThreadMessage;
  sentAtMs?: number;
}) {
  const { content } = message;
  if (message.text) {
    return <p className="whitespace-pre-wrap break-words">{message.text}</p>;
  }
  if (!content) return <MissingContent message={message} />;

  switch (content.type) {
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker":
      return (
        <div className="space-y-1">
          <MediaAttachment
            conversationId={conversationId}
            messageId={message.id}
            media={content}
            sentAtMs={sentAtMs}
          />
          {content.caption && (
            <p className="whitespace-pre-wrap break-words">{content.caption}</p>
          )}
        </div>
      );
    case "location":
      return <LocationView content={content} />;
    case "contacts":
      return <ContactsView content={content} />;
    case "button":
      return <ButtonView content={content} />;
    case "interactive":
      return <InteractiveView content={content} />;
    case "reaction":
      return (
        <p className="text-xs italic opacity-80">
          {content.emoji ? `Reacted ${content.emoji} to a message` : "Removed a reaction"}
        </p>
      );
    case "order":
      return <OrderView content={content} />;
    case "system":
      return (
        <p className="text-xs italic opacity-80">{content.body ?? "System message"}</p>
      );
    case "unsupported":
      return <MissingContent message={message} />;
    case "edit":
      return <UnmatchedEditView content={content} />;
    case "revoke":
      return <p className="text-xs italic opacity-80">🚫 Deleted an earlier message</p>;
  }
}

/** An edit whose original message isn't in the loaded thread. */
function UnmatchedEditView({ content }: { content: EditContent }) {
  const edited = content.text ?? content.content?.caption;
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide opacity-60">Edited an earlier message</p>
      {edited && <p className="whitespace-pre-wrap break-words">{edited}</p>}
    </div>
  );
}

function MissingContent({ message }: { message: ThreadMessage }) {
  const error = message.errors?.[0];
  const errorText = error?.details ?? error?.message;
  const hadContent = isMediaType(message.type) || CONTENT_TYPES.has(message.type);
  return (
    <div className="space-y-0.5">
      <p className="whitespace-pre-wrap break-words">{summarizeMessage(message)}</p>
      {errorText && <p className="text-xs opacity-70">{errorText}</p>}
      {!error && hadContent && (
        <p className="text-[11px] italic opacity-60">
          Details weren&apos;t saved for this message.
        </p>
      )}
    </div>
  );
}

function QuotedMessage({
  quoted,
  customerLabel,
}: {
  quoted: ThreadMessage | null;
  customerLabel: string;
}) {
  return (
    <div className="rounded-md border-l-4 border-emerald-500/70 bg-black/5 px-2 py-1 text-xs dark:bg-white/10">
      <p className="font-medium opacity-80">
        {quoted ? (quoted.direction === "out" ? "You" : customerLabel) : "Reply"}
      </p>
      <p className="line-clamp-2 break-words opacity-80">
        {quoted ? summarizeMessage(quoted) : "To an earlier message"}
      </p>
    </div>
  );
}

function ReferralCard({ referral }: { referral: MessageReferral }) {
  const link = safeExternalUrl(referral.sourceUrl);
  const isPost = referral.sourceType === "post";
  return (
    <div className="space-y-0.5 rounded-md bg-black/5 px-2 py-1.5 text-xs dark:bg-white/10">
      <p className="font-medium opacity-80">
        {isPost ? "Came from a post" : "Came from an ad"}
      </p>
      {referral.headline && <p className="font-medium">{referral.headline}</p>}
      {referral.body && <p className="line-clamp-3 opacity-80">{referral.body}</p>}
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="underline">
          View {isPost ? "post" : "ad"}
        </a>
      )}
    </div>
  );
}

function LocationView({ content }: { content: LocationContent }) {
  const link = safeExternalUrl(content.url);
  return (
    <div className="space-y-0.5">
      <p className="font-medium">📍 {content.name ?? "Shared location"}</p>
      {content.address && <p className="text-xs opacity-80">{content.address}</p>}
      <p className="flex flex-wrap gap-x-3 text-xs">
        <a
          href={mapsUrl(content.latitude, content.longitude)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Open in Google Maps
        </a>
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="underline">
            {new URL(link).hostname}
          </a>
        )}
      </p>
    </div>
  );
}

function ContactsView({ content }: { content: ContactsContent }) {
  return (
    <ul className="space-y-1.5">
      {content.contacts.map((contact, i) => (
        <li key={i} className="rounded-md bg-black/5 px-2 py-1.5 dark:bg-white/10">
          <p className="font-medium">👤 {contact.name}</p>
          {contact.organization && (
            <p className="text-xs opacity-80">{contact.organization}</p>
          )}
          {contact.phones.map((phone, j) => (
            <p key={j} className="text-xs">
              {phone.phone ?? `+${phone.waId}`}
              {phone.type ? ` · ${phone.type.toLowerCase()}` : ""}
              {phone.waId ? " · on WhatsApp" : ""}
            </p>
          ))}
          {contact.emails.map((email, j) => (
            <p key={j} className="text-xs opacity-80">
              {email}
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}

function ButtonView({ content }: { content: ButtonContent }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide opacity-60">Tapped a button</p>
      <p className="whitespace-pre-wrap break-words">
        {content.text ?? content.payload}
      </p>
      {content.text && content.payload && content.payload !== content.text && (
        <p className="break-all text-[11px] opacity-60">Payload: {content.payload}</p>
      )}
    </div>
  );
}

function InteractiveView({ content }: { content: InteractiveContent }) {
  const label =
    content.flowName === "address_message"
      ? "Address"
      : (lookupLabel(INTERACTIVE_LABELS, content.replyType) ?? "Interactive reply");
  const main =
    content.replyType === "call_permission_reply"
      ? summarizeMessage({ type: "interactive", content })
      : (content.title ?? content.flowBody);
  const price = content.salePrice ?? content.price;
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide opacity-60">{label}</p>
      {main && <p className="whitespace-pre-wrap break-words">{main}</p>}
      {content.description && <p className="text-xs opacity-80">{content.description}</p>}
      {price !== undefined && (
        <p className="text-xs">
          {formatPrice(price, content.currency)}
          {content.salePrice !== undefined && content.price !== undefined && (
            <span className="ml-1 line-through opacity-60">
              {formatPrice(content.price, content.currency)}
            </span>
          )}
        </p>
      )}
      {content.replyType === "product" && content.replyId && (
        <p className="break-all text-[11px] opacity-60">SKU {content.replyId}</p>
      )}
      {content.flowResponseJson && (
        <details className="text-xs">
          <summary className="cursor-pointer opacity-80">Submitted data</summary>
          <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-black/5 p-2 font-mono text-[11px] dark:bg-white/10">
            {prettyJson(content.flowResponseJson)}
          </pre>
        </details>
      )}
    </div>
  );
}

function OrderView({ content }: { content: OrderContent }) {
  return (
    <div className="space-y-1">
      <p className="font-medium">🛒 Order</p>
      {content.items.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {content.items.map((item, i) => (
            <li key={i}>
              {item.quantity ?? 1} × {item.productRetailerId ?? "item"}
              {item.itemPrice != null ? ` · ${formatPrice(item.itemPrice, item.currency)}` : ""}
            </li>
          ))}
        </ul>
      )}
      {content.text && <p className="whitespace-pre-wrap break-words">{content.text}</p>}
    </div>
  );
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function formatPrice(price: number, currency?: string): string {
  if (currency) {
    try {
      // Fixed locale so server and browser render the same string (no hydration mismatch).
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(price);
    } catch {
      // Unknown currency code: fall through to the plain format.
    }
  }
  return currency ? `${price} ${currency}` : String(price);
}
