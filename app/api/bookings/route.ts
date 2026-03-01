import { NextResponse } from "next/server"
import { stackServerApp } from "@/stack/server"
import { friendDb } from "@/lib/friend-db"

// GET /api/bookings — fetch all bookings from friend's DB for the current agent's customers
export async function GET() {
  try {
    const user = await stackServerApp.getUser({ or: "return-null" })
    if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

    const rows = await friendDb`
      SELECT
        b.booking_id,
        b.chat_id,
        b.user_id,
        b.provider_booking_id,
        b.pnr_details,
        b.trip_start_date,
        b.trip_end_date,
        b.booking_status,
        b.disruption_status,
        b.currency,
        b.pricing_breakdown,
        b.total_booking_amount,
        b.cancelled_items,
        b.cancelled_amount,
        b.refunded_amount,
        b.created_at,
        b.updated_at,
        u.name AS customer_name,
        u.phone_number
      FROM bookings b
      LEFT JOIN users u ON u.user_id = b.user_id
      ORDER BY b.created_at DESC
    `

    return NextResponse.json({ bookings: rows })
  } catch (err) {
    console.error("[GET /api/bookings]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
