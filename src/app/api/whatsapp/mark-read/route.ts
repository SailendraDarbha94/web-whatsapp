import { NextResponse } from "next/server";
import { verifyFirebaseIdToken } from "@/lib/firebase/admin";
import { markConversationRead } from "@/lib/whatsapp/store";

export const runtime = "nodejs";

type Body = { waId?: string };

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const idToken =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";
  if (!idToken) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header." },
      { status: 401 }
    );
  }

  try {
    await verifyFirebaseIdToken(idToken);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired session." },
      { status: 401 }
    );
  }

  let json: Body;
  try {
    json = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const waId = typeof json.waId === "string" ? json.waId.trim() : "";
  if (!waId) {
    return NextResponse.json({ error: "Field `waId` is required." }, { status: 400 });
  }

  try {
    await markConversationRead(waId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/whatsapp/mark-read] failed:", e);
    return NextResponse.json({ error: "Could not update conversation." }, { status: 500 });
  }
}
