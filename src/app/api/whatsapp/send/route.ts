import { NextResponse } from "next/server";
import { verifyFirebaseIdToken } from "@/lib/firebase/admin";
import { sendWhatsAppMessage } from "@/lib/whatsapp/cloud-api";

export const runtime = "nodejs";

type Body = {
  to?: string;
  mode?: "text" | "template";
  message?: string;
  templateName?: string;
  templateLanguage?: string;
};

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const idToken = extractBearerToken(authHeader);
  if (!idToken) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header." },
      { status: 401 }
    );
  }

  try {
    await verifyFirebaseIdToken(idToken);
  } catch (e: unknown) {
    const info = getErrorInfo(e);
    const msg = info.message;

    if (msg.includes("FIREBASE_ADMIN_CREDENTIALS_INVALID")) {
      return NextResponse.json(
        {
          error:
            "Firebase Admin private key is invalid or malformed. Re-copy private_key from the service account JSON into .env.local (one line in double quotes, \\n as in JSON).",
        },
        { status: 500 }
      );
    }
    if (
      msg.includes("Firebase Admin env not loaded") ||
      msg.includes("Missing FIREBASE_ADMIN_PROJECT_ID")
    ) {
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const devHint =
      process.env.NODE_ENV === "development"
        ? ` (${info.code ? info.code + ": " : ""}${msg})`
        : "";
    const audienceMismatch =
      /audience|claim.*aud|incorrect.*aud/i.test(msg) || /\baud\b/i.test(msg);
    const userMessage = audienceMismatch
      ? "Firebase project mismatch: use the same project in client config (firebaseConfig) and FIREBASE_ADMIN_PROJECT_ID." +
        devHint
      : "Invalid or expired session. Sign out and sign in again." + devHint;

    console.error("[api/whatsapp/send] ID token verification failed:", info.code, msg);

    return NextResponse.json({ error: userMessage }, { status: 401 });
  }

  let json: Body;
  try {
    json = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const to = typeof json.to === "string" ? json.to.trim() : "";
  if (!to) {
    return NextResponse.json({ error: "Field `to` is required." }, { status: 400 });
  }

  const mode = json.mode === "template" ? "template" : "text";

  try {
    if (mode === "text") {
      const message = typeof json.message === "string" ? json.message : "";
      if (!message.trim()) {
        return NextResponse.json(
          { error: "Field `message` is required for text mode." },
          { status: 400 }
        );
      }
      const result = await sendWhatsAppMessage({
        mode: "text",
        to,
        body: message,
      });
      return NextResponse.json({ ok: true, result });
    }

    const templateName =
      typeof json.templateName === "string" && json.templateName.trim()
        ? json.templateName.trim()
        : "hello_world";
    const templateLanguage =
      typeof json.templateLanguage === "string" && json.templateLanguage.trim()
        ? json.templateLanguage.trim()
        : "en_US";

    const result = await sendWhatsAppMessage({
      mode: "template",
      to,
      templateName,
      templateLanguage,
    });
    return NextResponse.json({ ok: true, result });
  } catch (e: unknown) {
    const err = e as Error & { status?: number };
    const message = err.message || "Request failed.";
    if (
      message.includes("WhatsApp env not loaded") ||
      message.includes("WHATSAPP_PHONE_NUMBER_ID") ||
      message.includes("WHATSAPP_ACCESS_TOKEN")
    ) {
      console.error("WhatsApp send configuration:", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
    if (message.includes("Invalid phone number")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    const status =
      typeof err.status === "number" && err.status >= 400 && err.status <= 599
        ? err.status
        : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

function extractBearerToken(header: string | null): string | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length ? token : null;
}

function getErrorInfo(e: unknown): { message: string; code?: string } {
  if (typeof e === "object" && e !== null) {
    const o = e as { message?: unknown; code?: unknown };
    const message =
      typeof o.message === "string" ? o.message : String(e);
    const code = typeof o.code === "string" ? o.code : undefined;
    return { message, code };
  }
  return { message: String(e) };
}
