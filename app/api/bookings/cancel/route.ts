import { NextRequest, NextResponse } from "next/server"
import { stackServerApp } from "@/stack/server"

const TBO_URL = process.env.NEXT_PUBLIC_BACKEND_URL!

// POST /api/bookings/cancel
// Body: { provider_booking_id, selected_days: number[] }
// Proxies to POST /cancellation/cancel/{provider_booking_id}
export async function POST(req: NextRequest) {
  try {
    const user = await stackServerApp.getUser({ or: "return-null" })
    if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

    const { provider_booking_id, selected_days } = await req.json() as {
      provider_booking_id: string
      selected_days: number[]
    }

    if (!provider_booking_id || !selected_days?.length) {
      return NextResponse.json(
        { error: "provider_booking_id and selected_days are required" },
        { status: 400 }
      )
    }

    const res = await fetch(
      `${TBO_URL}/cancellation/cancel/${encodeURIComponent(provider_booking_id)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancellation_type: "partial", selected_days }),
      }
    )

    const text = await res.text()
    let data: unknown
    try { data = JSON.parse(text) } catch { data = { raw: text } }

    if (!res.ok) {
      console.error("[cancel] TBO error", res.status, text)
      return NextResponse.json(
        { error: "Cancellation failed", detail: data },
        { status: res.status }
      )
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error("[POST /api/bookings/cancel]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
