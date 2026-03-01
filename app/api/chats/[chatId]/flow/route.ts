import { NextRequest, NextResponse } from "next/server"
import { stackServerApp } from "@/stack/server"
import { friendDb } from "@/lib/friend-db"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL!

type Params = { params: Promise<{ chatId: string }> }

// POST /api/chats/[chatId]/flow
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await stackServerApp.getUser({ or: "return-null" })
    if (!user) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }

    const { chatId } = await params
    const body = await req.json()

    // API expects { message, process_pending_uploads, update_persona }
    // Our frontend sends { text, edited_structured_requirement }
    const backendPayload: Record<string, unknown> = {
      message: body.text ?? body.message ?? "",
      process_pending_uploads: true,
      update_persona: true,
    }
    if (body.edited_structured_requirement) {
      backendPayload.edited_structured_requirement = body.edited_structured_requirement
    }

    console.log(`[chat-flow] chat=${chatId} message="${String(backendPayload.message).slice(0, 80)}"`)

    const res = await fetch(`${BACKEND_URL}/chat-flow/${chatId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backendPayload),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error("[chat-flow POST] backend error:", text)
      return NextResponse.json({ error: "Backend error" }, { status: res.status })
    }

    // Fetch user_persona AFTER the backend responds — the backend writes the
    // updated persona during this call, so we read it after to see the new value.
    const data = await res.json()
    // 🔍 Log full backend response so we can see the exact shape
    console.log(`[chat-flow] FULL RESPONSE:`, JSON.stringify(data, null, 2))

    const personaRows = await friendDb`
      SELECT u.user_persona
      FROM chats c
      JOIN users u ON u.user_id = c.user_id
      WHERE c.chat_id = ${chatId}
      LIMIT 1
    `
    const userPersona = personaRows[0]?.user_persona ?? null
    console.log(`[chat-flow] user_persona for chat=${chatId}:`, userPersona)

    return NextResponse.json(data)
  } catch (err) {
    console.error("[chat-flow POST]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
