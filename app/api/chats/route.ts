import { NextRequest, NextResponse } from "next/server"
import { stackServerApp } from "@/stack/server"
import { prisma } from "@/lib/prisma"
import { friendDb } from "@/lib/friend-db"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL!

// POST /api/chats  — optionally create user, then create a new chat session
export async function POST(req: NextRequest) {
  try {
    const user = await stackServerApp.getUser({ or: "return-null" })
    if (!user) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }

    const { phone_number, name, email } = await req.json()
    if (!phone_number) {
      return NextResponse.json({ error: "phone_number is required" }, { status: 400 })
    }

    // Get agent_id from local DB
    const agent = await prisma.travelAgent.findUnique({
      where: { stackauth_id: user.id },
    })
    if (!agent) {
      return NextResponse.json({ error: "Agent not found — sync first" }, { status: 404 })
    }

    // Check if user exists in friend's DB; create if not
    const existing = await friendDb`
      SELECT user_id FROM users WHERE phone_number = ${phone_number} LIMIT 1
    `

    if (existing.length === 0) {
      // name is required for new users
      if (!name?.trim()) {
        return NextResponse.json(
          { error: "User not found. Please provide name to create a new user." },
          { status: 404 }
        )
      }
      await friendDb`
        INSERT INTO users (phone_number, name, email)
        VALUES (${phone_number}, ${name.trim()}, ${email?.trim() ?? null})
      `
      console.log(`[chats POST] 🆕 created user phone=${phone_number} name=${name}`)
    }

    // POST /chats on friend's backend — now user definitely exists
    const chatRes = await fetch(`${BACKEND_URL}/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_number }),
    })

    if (!chatRes.ok) {
      const text = await chatRes.text()
      console.error("[chats POST] backend error:", text)
      return NextResponse.json(
        { error: "Failed to create chat", detail: text },
        { status: chatRes.status }
      )
    }

    const data = await chatRes.json()
    console.log(`[chats POST] ✅ chat_id=${data.chat_id} phone=${phone_number}`)
    return NextResponse.json(data)
  } catch (err) {
    console.error("[chats POST]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// GET /api/chats — list all chats with user info, queried directly from friend's DB
export async function GET(req: NextRequest) {
  try {
    const user = await stackServerApp.getUser({ or: "return-null" })
    if (!user) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }

    const agent = await prisma.travelAgent.findUnique({
      where: { stackauth_id: user.id },
    })
    if (!agent) {
      return NextResponse.json({ chats: [] })
    }

    // Query friend's DB directly — JOIN users to get phone + name + destinations
    const rows = await friendDb`
      SELECT
        c.chat_id,
        c.status,
        c.updated_at,
        c.created_at,
        u.phone_number,
        u.name        AS customer_name,
        u.email,
        COALESCE(
          ARRAY(SELECT jsonb_array_elements_text(
            c.structured_requirement->'route_plan'->'destinations'
          )),
          '{}'
        ) AS destinations
      FROM chats c
      JOIN users u ON u.user_id = c.user_id
      ORDER BY c.updated_at DESC
      LIMIT 200
    `

    const chats = rows.map((r) => ({
      chat_id:       r.chat_id,
      phone_number:  r.phone_number,
      customer_name: r.customer_name ?? null,
      status:        r.status ?? null,
      created_at:    r.created_at,
      updated_at:    r.updated_at,
      destinations:  (r.destinations as string[])?.filter(Boolean) ?? [],
    }))

    return NextResponse.json({ chats })
  } catch (err) {
    console.error("[chats GET]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
