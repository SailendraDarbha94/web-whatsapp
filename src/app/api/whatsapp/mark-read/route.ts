import { NextResponse } from "next/server";
import { authorizeOperator } from "@/lib/firebase/operator-auth";
import { isConversationId } from "@/lib/whatsapp/ids";
import { markConversationRead } from "@/lib/whatsapp/store";

export const runtime = "nodejs";

/** `waId` is the older name for `conversationId`; both are accepted. */
type Body = { conversationId?: unknown; waId?: unknown };

export async function POST(request: Request) {
  const auth = await authorizeOperator(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let json: Body;
  try {
    json = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const raw = json?.conversationId ?? json?.waId;
  const conversationId = typeof raw === "string" ? raw.trim() : "";
  if (!isConversationId(conversationId)) {
    return NextResponse.json(
      { error: "Field `conversationId` must be a conversation id." },
      { status: 400 }
    );
  }

  try {
    await markConversationRead(conversationId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/whatsapp/mark-read] failed:", e);
    return NextResponse.json({ error: "Could not update conversation." }, { status: 500 });
  }
}
