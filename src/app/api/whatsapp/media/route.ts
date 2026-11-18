import { NextResponse, type NextRequest } from "next/server";
import { authorizeOperator } from "@/lib/firebase/operator-auth";
import { fetchWhatsAppMedia, WhatsAppMediaError } from "@/lib/whatsapp/cloud-api";
import { isConversationId, isValidDocumentId } from "@/lib/whatsapp/ids";
import { getInboundMedia } from "@/lib/whatsapp/store";

export const runtime = "nodejs";

/**
 * Types the browser may render inline (<img>, <audio>, <video>). Everything
 * else, including SVG, HTML and PDF, is served as an opaque download so
 * customer-supplied files can never run as a page on this origin.
 */
const INLINE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/aac",
  "audio/amr",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "video/mp4",
  "video/3gpp",
]);

/**
 * GET /api/whatsapp/media?conversation={conversationId}&message={wamid}
 *
 * Streams the media attached to a stored inbound message. The media id comes
 * from Firestore, not from the caller, so this can't be used to fetch
 * arbitrary media with the business token. Requires an operator's Firebase ID
 * token in `Authorization: Bearer …`.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeOperator(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = request.nextUrl.searchParams;
  const waId = params.get("conversation") ?? "";
  const wamid = params.get("message") ?? "";
  if (!isConversationId(waId) || !isValidDocumentId(wamid)) {
    return NextResponse.json(
      { error: "Invalid conversation or message id." },
      { status: 400 }
    );
  }

  let media;
  try {
    media = await getInboundMedia(waId, wamid);
  } catch (e) {
    console.error("[api/whatsapp/media] Firestore lookup failed:", e);
    return NextResponse.json({ error: "Could not look up the message." }, { status: 500 });
  }
  if (!media) {
    return NextResponse.json({ error: "This message has no media." }, { status: 404 });
  }

  try {
    // request.signal aborts the upstream download if the browser goes away.
    const download = await fetchWhatsAppMedia(media.mediaId, {
      signal: request.signal,
      expectedMimeType: media.mimeType,
    });
    return new Response(download.body, {
      headers: {
        "Content-Type": servedContentType(download.contentType ?? media.mimeType),
        "Content-Disposition": "attachment",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof WhatsAppMediaError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("WhatsApp env not loaded")) {
      console.error("[api/whatsapp/media] configuration:", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
    console.error("[api/whatsapp/media] failed:", e);
    return NextResponse.json({ error: "Could not load the media." }, { status: 502 });
  }
}

/**
 * Next.js answers HEAD with the GET handler, which would start (and then
 * abandon) a full download from Meta. Nothing needs HEAD here.
 */
export function HEAD() {
  return new Response(null, { status: 405, headers: { Allow: "GET" } });
}

function servedContentType(raw: string | undefined): string {
  const base = raw?.split(";")[0]?.trim().toLowerCase();
  return base && INLINE_TYPES.has(base) ? base : "application/octet-stream";
}
