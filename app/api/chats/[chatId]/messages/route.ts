import { NextRequest, NextResponse } from "next/server"
import { stackServerApp } from "@/stack/server"
import { friendDb } from "@/lib/friend-db"
import { prisma } from "@/lib/prisma"

type Params = { params: Promise<{ chatId: string }> }

// GET /api/chats/[chatId]/messages
// Returns structured_requirement (friend DB) + stored messages (own DB).
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await stackServerApp.getUser({ or: "return-null" })
    if (!user) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }

    const { chatId } = await params

    // Fetch structured_requirement from friend's DB
    const rows = await friendDb`
      SELECT
        c.chat_id,
        c.structured_requirement,
        c.status,
        u.phone_number,
        u.name AS customer_name
      FROM chats c
      JOIN users u ON u.user_id = c.user_id
      WHERE c.chat_id = ${chatId}
      LIMIT 1
    `

    // Fetch stored messages from own DB
    const dbMessages = await prisma.message.findMany({
      where: { chat_id: chatId },
      orderBy: { created_at: "asc" },
    })

    const messages = dbMessages.map((m) => ({
      id: m.id,
      chat_id: m.chat_id,
      role: m.role as "user" | "assistant",
      content: m.content,
      structuredData: m.structured_data ?? undefined,
      created_at: m.created_at.toISOString(),
    }))

    if (rows.length === 0) {
      return NextResponse.json({ structured_requirement: null, messages })
    }

    const row = rows[0]
    return NextResponse.json({
      structured_requirement: row.structured_requirement ?? null,
      status: row.status ?? null,
      phone_number: row.phone_number,
      customer_name: row.customer_name ?? null,
      messages,
    })
  } catch (err) {
    console.error("[messages GET]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST /api/chats/[chatId]/messages
// Saves a single message to own DB.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await stackServerApp.getUser({ or: "return-null" })
    if (!user) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }

    const { chatId } = await params
    const body = await req.json()
    const { id, role, content, structured_data, created_at } = body

    if (!role || (content === undefined)) {
      return NextResponse.json({ error: "role and content are required" }, { status: 400 })
    }

    // Backend may return non-UUID ids (e.g. "system_123", "ai_456").
    // Prisma's UUID column rejects them — generate a fresh UUID when the id isn't valid.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const resolvedId = id && UUID_RE.test(id) ? id : crypto.randomUUID()

    const saved = await prisma.message.upsert({
      where: { id: resolvedId },
      update: {}, // don't overwrite existing messages
      create: {
        id: resolvedId,
        chat_id: chatId,
        role,
        content: content ?? "",
        structured_data: structured_data ?? undefined,
        created_at: created_at ? new Date(created_at) : undefined,
      },
    })

    return NextResponse.json({ id: saved.id })
  } catch (err) {
    console.error("[messages POST]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
