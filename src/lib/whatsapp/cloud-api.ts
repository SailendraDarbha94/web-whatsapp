export type SendWhatsAppPayload =
  | {
      mode: "text";
      to: string;
      body: string;
    }
  | {
      mode: "template";
      to: string;
      templateName: string;
      templateLanguage: string;
    };

export function normalizeWhatsAppTo(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    throw new Error(
      "Invalid phone number. Include country code (8–15 digits after normalization)."
    );
  }
  return digits;
}

function readWhatsAppConfig(): {
  version: string;
  phoneNumberId: string;
  token: string;
} {
  const version = process.env.WHATSAPP_API_VERSION?.trim() || "v25.0";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();

  if (!phoneNumberId || !token) {
    const missing: string[] = [];
    if (!phoneNumberId) missing.push("WHATSAPP_PHONE_NUMBER_ID");
    if (!token) missing.push("WHATSAPP_ACCESS_TOKEN");
    throw new Error(
      `WhatsApp env not loaded: ${missing.join(", ")}. Add them to .env.local next to package.json (exact names), save, then restart \`npm run dev\`. On Vercel/hosting, add the same keys in the project environment settings.`
    );
  }

  return { version, phoneNumberId, token };
}

export async function sendWhatsAppMessage(payload: SendWhatsAppPayload) {
  const { version, phoneNumberId, token } = readWhatsAppConfig();

  const to = normalizeWhatsAppTo(payload.to);

  const graphBody: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to,
    type: payload.mode,
  };

  if (payload.mode === "text") {
    graphBody.text = {
      preview_url: false,
      body: payload.body.trim(),
    };
  } else {
    graphBody.template = {
      name: payload.templateName,
      language: { code: payload.templateLanguage },
    };
  }

  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(graphBody),
  });

  const data = (await res.json().catch(() => null)) as GraphResponse | null;

  if (!res.ok) {
    console.error(
      "[whatsapp/cloud-api] Meta Graph API error:",
      JSON.stringify({ httpStatus: res.status, body: data }, null, 2)
    );
    const message = formatGraphError(data, res.status);
    const err = new Error(message) as Error & { status?: number; raw?: unknown };
    // Map Meta 401/403 to 502 so clients don't confuse WhatsApp token failures with Firebase 401
    err.status =
      res.status === 401 || res.status === 403 ? 502 : res.status;
    err.raw = data;
    throw err;
  }

  return data as GraphSuccessResponse;
}

type GraphErrorEntry = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  is_transient?: boolean;
};

type GraphResponse = {
  error?: GraphErrorEntry;
  messages?: unknown;
};

type GraphSuccessResponse = {
  messaging_product?: string;
  contacts?: unknown;
  messages?: { id?: string }[];
};

/** Thrown by fetchWhatsAppMedia. `status` is the HTTP status to return to the browser. */
export class WhatsAppMediaError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "WhatsAppMediaError";
    this.status = status;
  }
}

type GraphMediaResponse = {
  url?: string;
  mime_type?: string;
  file_size?: number | string;
  id?: string;
  error?: GraphErrorEntry;
};

const MEDIA_ID_PATTERN = /^\d{1,32}$/;
const MEDIA_LOOKUP_TIMEOUT_MS = 15_000;
/** Time allowed for the download to start; the body then streams to the browser. */
const MEDIA_DOWNLOAD_HEADERS_TIMEOUT_MS = 20_000;
/** Hosts Meta serves media from. The bearer token is never sent anywhere else. */
const META_MEDIA_HOST_SUFFIXES = [".fbsbx.com", ".fbcdn.net", ".facebook.com", ".whatsapp.net"];

const MEDIA_EXPIRED_MESSAGE =
  "This media is no longer available. WhatsApp only keeps customer media for 7 days.";

/** "Audio/OGG; codecs=opus" -> "audio/ogg". */
function baseType(mimeType: string | undefined): string | undefined {
  return mimeType?.split(";")[0]?.trim().toLowerCase() || undefined;
}

/** The browser went away mid-request; nobody will see the response. */
function cancelledError(): WhatsAppMediaError {
  return new WhatsAppMediaError("Request cancelled.", 499);
}

function isMetaMediaHost(hostname: string): boolean {
  return META_MEDIA_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function withTimeout(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

/**
 * Download inbound media by its Meta media id: resolve the id to a
 * short-lived URL (GET /{media-id}, valid for 5 minutes), then fetch that URL
 * with the same bearer token. The token never leaves the server; callers
 * stream `body` onward. Pass the incoming request's `signal` so the upstream
 * download stops if the browser goes away.
 */
export async function fetchWhatsAppMedia(
  mediaId: string,
  options: {
    signal?: AbortSignal;
    /** The mime_type the webhook reported, to tell real HTML files from error pages. */
    expectedMimeType?: string;
  } = {}
): Promise<{
  body: ReadableStream<Uint8Array>;
  contentType?: string;
}> {
  if (!MEDIA_ID_PATTERN.test(mediaId)) {
    throw new WhatsAppMediaError("Invalid media id.", 400);
  }
  const { version, phoneNumberId, token } = readWhatsAppConfig();
  const { signal } = options;
  const expectsHtml = baseType(options.expectedMimeType) === "text/html";

  // A 404 from the download URL usually means it expired between the two
  // calls; Meta's guidance is to look the id up again once.
  for (let attempt = 1; ; attempt++) {
    const downloadUrl = await resolveMediaUrl(mediaId, version, phoneNumberId, token, signal);

    const headersTimeout = new AbortController();
    const timer = setTimeout(() => headersTimeout.abort(), MEDIA_DOWNLOAD_HEADERS_TIMEOUT_MS);
    let fileRes: Response;
    try {
      fileRes = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: signal ? AbortSignal.any([headersTimeout.signal, signal]) : headersTimeout.signal,
      });
    } catch (e) {
      if (signal?.aborted) throw cancelledError();
      console.error("[whatsapp/cloud-api] media download request failed:", e);
      throw new WhatsAppMediaError("Could not download the media from WhatsApp.", 502);
    } finally {
      clearTimeout(timer);
    }

    const contentType = fileRes.headers.get("content-type") ?? undefined;
    // An HTML body is an error page, unless the customer really sent an HTML file.
    const looksLikeErrorPage = baseType(contentType) === "text/html" && !expectsHtml;
    if (fileRes.ok && fileRes.body && !looksLikeErrorPage) {
      return { body: fileRes.body, contentType };
    }

    await fileRes.body?.cancel().catch(() => {});
    if (fileRes.status === 404 && attempt < 2) continue;
    console.error(
      "[whatsapp/cloud-api] media download failed:",
      JSON.stringify({ httpStatus: fileRes.status, contentType: contentType ?? null })
    );
    throw fileRes.status === 404
      ? new WhatsAppMediaError(MEDIA_EXPIRED_MESSAGE, 410)
      : new WhatsAppMediaError("Could not download the media from WhatsApp.", 502);
  }
}

/** GET /{media-id}: returns the short-lived download URL for the media. */
async function resolveMediaUrl(
  mediaId: string,
  version: string,
  phoneNumberId: string,
  token: string,
  signal?: AbortSignal
): Promise<URL> {
  const lookupUrl = new URL(`https://graph.facebook.com/${version}/${mediaId}`);
  // Only succeeds if the media belongs to this business phone number.
  lookupUrl.searchParams.set("phone_number_id", phoneNumberId);

  let lookupRes: Response;
  try {
    lookupRes = await fetch(lookupUrl, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: withTimeout(MEDIA_LOOKUP_TIMEOUT_MS, signal),
    });
  } catch (e) {
    if (signal?.aborted) throw cancelledError();
    console.error("[whatsapp/cloud-api] media lookup request failed:", e);
    throw new WhatsAppMediaError("Could not reach WhatsApp to look up the media.", 502);
  }

  const meta = (await lookupRes.json().catch(() => null)) as GraphMediaResponse | null;
  if (!lookupRes.ok || !meta?.url) {
    console.error(
      "[whatsapp/cloud-api] media lookup failed:",
      JSON.stringify({ httpStatus: lookupRes.status, error: meta?.error ?? null })
    );
    throw mediaLookupError(meta, lookupRes.status);
  }

  let downloadUrl: URL;
  try {
    downloadUrl = new URL(meta.url);
  } catch {
    throw new WhatsAppMediaError("WhatsApp returned an invalid media URL.", 502);
  }
  if (downloadUrl.protocol !== "https:" || !isMetaMediaHost(downloadUrl.hostname)) {
    console.error(
      "[whatsapp/cloud-api] refusing to send the access token to media host:",
      downloadUrl.hostname
    );
    throw new WhatsAppMediaError("WhatsApp returned an unexpected media URL.", 502);
  }
  return downloadUrl;
}

/** Graph rate-limit / throttling codes (some arrive as HTTP 400 or 403). */
const GRAPH_THROTTLE_CODES = new Set([4, 17, 32, 613, 80007, 130429]);

function mediaLookupError(
  data: GraphMediaResponse | null,
  httpStatus: number
): WhatsAppMediaError {
  const code = data?.error?.code;
  if (data?.error?.is_transient === true || (code !== undefined && GRAPH_THROTTLE_CODES.has(code))) {
    return new WhatsAppMediaError("WhatsApp is busy right now. Try again in a moment.", 503);
  }
  if (httpStatus === 401 || httpStatus === 403 || code === 190) {
    return new WhatsAppMediaError(
      "WhatsApp rejected the access token (WHATSAPP_ACCESS_TOKEN).",
      502
    );
  }
  // Code 100 / HTTP 400 or 404: the id is unknown, expired, or not on this number.
  if (code === 100 || httpStatus === 400 || httpStatus === 404) {
    return new WhatsAppMediaError(MEDIA_EXPIRED_MESSAGE, 410);
  }
  return new WhatsAppMediaError(
    `Could not look up the media on WhatsApp (HTTP ${httpStatus}).`,
    502
  );
}

function formatGraphError(data: GraphResponse | null, httpStatus: number): string {
  const rawMsg = data?.error?.message;
  const oauthCode = data?.error?.code;
  const subcode = data?.error?.error_subcode;

  const metaDetail = [
    rawMsg && `message: ${rawMsg}`,
    oauthCode != null && `code: ${oauthCode}`,
    subcode != null && `subcode: ${subcode}`,
  ]
    .filter(Boolean)
    .join(", ");

  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    oauthCode === 190 ||
    (rawMsg &&
      /authentication|invalid.*session|oauth|access token/i.test(rawMsg))
  ) {
    return (
      "WhatsApp API rejected the access token (WHATSAPP_ACCESS_TOKEN). " +
      "In Meta for Developers, open your app → WhatsApp → API setup: use a current System User or temporary token with whatsapp_business_messaging, " +
      "and ensure WHATSAPP_PHONE_NUMBER_ID is the 'Phone number ID' for that WhatsApp Business account." +
      (metaDetail ? ` Meta said: ${metaDetail}.` : "")
    ).trim();
  }

  if (metaDetail) return `WhatsApp API error (HTTP ${httpStatus}): ${metaDetail}.`;
  if (rawMsg) return rawMsg;
  if (httpStatus >= 400) return `WhatsApp API error (HTTP ${httpStatus}).`;
  return "WhatsApp API request failed.";
}
