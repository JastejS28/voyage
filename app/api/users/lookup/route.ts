import { NextRequest, NextResponse } from "next/server"
import { stackServerApp } from "@/stack/server"
import { friendDb } from "@/lib/friend-db"

// GET /api/users/lookup?phone=+1234567890
export async function GET(req: NextRequest) {
  try {
    const user = await stackServerApp.getUser({ or: "return-null" })
    if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

    const phone = req.nextUrl.searchParams.get("phone")?.trim()
    if (!phone) return NextResponse.json({ error: "phone is required" }, { status: 400 })

    const rows = await friendDb`
      SELECT user_id, phone_number, name, email
      FROM users
      WHERE phone_number = ${phone}
      LIMIT 1
    `

    if (rows.length === 0) {
      return NextResponse.json({ found: false })
    }

    return NextResponse.json({ found: true, user: rows[0] })
  } catch (err) {
    console.error("[users/lookup]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
