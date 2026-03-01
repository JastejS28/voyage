import { NextRequest, NextResponse } from "next/server"
import { stackServerApp } from "@/stack/server"

// Itinerary backend is a separate service from the chat-flow backend
const BACKEND_URL = process.env.ITINERARY_BACKEND_URL!

// POST /api/itinerary/generate
// Body: { structured_requirement: StructuredRequirement, chat_id?: string }
// Proxies to {BACKEND_URL}/generate and returns { core_itinerary, premium_itinerary, budget_itinerary, errors, elapsed_seconds }
export async function POST(req: NextRequest) {
  try {
    const user = await stackServerApp.getUser({ or: "return-null" })
    if (!user) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }

    const body = await req.json()
    const { structured_requirement } = body

    if (!structured_requirement) {
      return NextResponse.json({ error: "structured_requirement is required" }, { status: 400 })
    }

    console.log(`[itinerary/generate] Calling ${BACKEND_URL}/generate ...`)

    const res = await fetch(`${BACKEND_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structured_requirement,
        parallel: true,   // run core/premium/budget agents in parallel
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error("[itinerary/generate] backend error:", text)
      return NextResponse.json({ error: "Backend error", detail: text }, { status: res.status })
    }

    const data = await res.json()
    console.log(`[itinerary/generate] received plans: core=${!!data.core_itinerary} premium=${!!data.premium_itinerary} budget=${!!data.budget_itinerary} elapsed=${data.elapsed_seconds}s`)
    return NextResponse.json(data)
  } catch (err) {
    console.error("[itinerary/generate]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
