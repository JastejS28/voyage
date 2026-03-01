import { NextRequest, NextResponse } from "next/server"
import { stackServerApp } from "@/stack/server"
import { prisma } from "@/lib/prisma"

// POST /api/agent/sync
// Called on first load after login to upsert the travel agent record.
export async function POST(req: NextRequest) {
  try {
    const user = await stackServerApp.getUser({ or: "return-null" })

    if (!user) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }

    const stackauth_id = user.id
    const name = user.displayName ?? null
    const email = user.primaryEmail ?? null

    // Upsert: create if not exists, skip update if already present
    const agent = await prisma.travelAgent.upsert({
      where: { stackauth_id },
      update: { name, email },
      create: { stackauth_id, name, email },
    })

    return NextResponse.json({ agent })
  } catch (err) {
    console.error("[agent/sync]", err)
    return NextResponse.json(
      { error: "Failed to sync agent" },
      { status: 500 }
    )
  }
}
