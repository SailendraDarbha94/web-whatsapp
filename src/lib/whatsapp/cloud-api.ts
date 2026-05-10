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

export async function sendWhatsAppMessage(payload: SendWhatsAppPayload) {
  const version = process.env.WHATSAPP_API_VERSION ?? "v25.0";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();

  const missing: string[] = [];
  if (!phoneNumberId) missing.push("WHATSAPP_PHONE_NUMBER_ID");
  if (!token) missing.push("WHATSAPP_ACCESS_TOKEN");

  if (missing.length > 0) {
    throw new Error(
      `WhatsApp env not loaded: ${missing.join(", ")}. Add them to .env.local next to package.json (exact names), save, then restart \`npm run dev\`. On Vercel/hosting, add the same keys in the project environment settings.`
    );
  }

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
    const message = formatGraphError(data, res.status);
    const err = new Error(message) as Error & { status?: number; raw?: unknown };
    // Map Meta 401/403 to 502 so clients don’t confuse WhatsApp token failures with Firebase 401
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

function formatGraphError(data: GraphResponse | null, httpStatus: number): string {
  const rawMsg = data?.error?.message;
  const oauthCode = data?.error?.code;

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
      "and ensure WHATSAPP_PHONE_NUMBER_ID is the “Phone number ID” for that WhatsApp Business account. " +
      (rawMsg && rawMsg !== "Authentication Error" ? `Meta said: ${rawMsg}` : "")
    ).trim();
  }

  if (rawMsg) return rawMsg;
  if (httpStatus >= 400) return `WhatsApp API error (HTTP ${httpStatus}).`;
  return "WhatsApp API request failed.";
}
