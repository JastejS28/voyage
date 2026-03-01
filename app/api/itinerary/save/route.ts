import { NextRequest, NextResponse } from "next/server"
import { stackServerApp } from "@/stack/server"
import { prisma } from "@/lib/prisma"
import { friendDb } from "@/lib/friend-db"

// POST /api/itinerary/save
// Body: { chat_id, plan, tab_id }
// 1. Upserts bookings row with the full plan JSON
// 2. Updates chats.itinerary JSONB column
export async function POST(req: NextRequest) {
  try {
    const user = await stackServerApp.getUser({ or: "return-null" })
    if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

    // Resolve agent → get user_id from friend's DB via agent's chats
    const agent = await prisma.travelAgent.findUnique({ where: { stackauth_id: user.id } })
    if (!agent) return NextResponse.json({ error: "Agent not found — sync first" }, { status: 404 })

    const body = await req.json() as {
      chat_id: string
      plan: {
        summary?: string
        total_estimated_cost?: { amount: number; currency: string }
        days?: Array<{ day: number; date?: string; city?: string; hotel?: unknown; flights?: unknown[]; activities?: unknown[]; meals?: unknown[] }>
        metadata?: unknown
        plan_type?: string
      }
      tab_id: string
      booking_ref?: string
    }

    const { chat_id, plan, tab_id, booking_ref } = body
    if (!chat_id || !plan) {
      return NextResponse.json({ error: "chat_id and plan are required" }, { status: 400 })
    }

    // Fetch chat to get user_id
    const chatRows = await friendDb`
      SELECT user_id FROM chats WHERE chat_id = ${chat_id} LIMIT 1
    `
    if (chatRows.length === 0) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 })
    }
    const chatUserId: string = chatRows[0].user_id

    // Derive trip dates from the plan's first and last day
    const days = plan.days ?? []
    const firstDay = days[0]
    const lastDay = days[days.length - 1]
    const tripStart = firstDay?.date ? new Date(firstDay.date) : new Date()
    const tripEnd = lastDay?.date ? new Date(lastDay.date) : new Date()

    const totalAmount = plan.total_estimated_cost?.amount ?? 0
    const currency = plan.total_estimated_cost?.currency ?? "INR"

    // Build pricing_breakdown array from day hotels + activities
    const pricingBreakdown = days.flatMap((d) => {
      const items: Array<{ day: number; type: string; description: string; amount: number; currency: string }> = []
      const hotel = d.hotel as { name?: string; price_per_night?: { amount?: number; currency?: string } } | null
      if (hotel?.price_per_night?.amount) {
        items.push({ day: d.day, type: "hotel", description: hotel.name ?? "Hotel", amount: hotel.price_per_night.amount, currency: hotel.price_per_night.currency ?? currency })
      }
      const flights = (d.flights ?? []) as Array<{ airline?: string; flight_number?: string; price?: { amount?: number; currency?: string } }>
      for (const f of flights) {
        if (f.price?.amount) {
          items.push({ day: d.day, type: "flight", description: `${f.airline ?? ""} ${f.flight_number ?? ""}`.trim(), amount: f.price.amount, currency: f.price.currency ?? currency })
        }
      }
      const activities = (d.activities ?? []) as Array<{ name?: string; cost?: { amount?: number; currency?: string } }>
      for (const a of activities) {
        if (a.cost?.amount) {
          items.push({ day: d.day, type: "activity", description: a.name ?? "Activity", amount: a.cost.amount, currency: a.cost.currency ?? currency })
        }
      }
      return items
    })

    const pnrDetails = {
      booking_ref: booking_ref ?? null,
      tab_id,
      plan_type: plan.plan_type ?? tab_id,
      summary: plan.summary,
      metadata: plan.metadata,
      days: plan.days,
    }

    // 1. Insert booking
    const bookingRows = await friendDb`
      INSERT INTO bookings (
        chat_id,
        user_id,
        provider_booking_id,
        pnr_details,
        trip_start_date,
        trip_end_date,
        booking_status,
        currency,
        pricing_breakdown,
        total_booking_amount
      ) VALUES (
        ${chat_id},
        ${chatUserId},
        ${booking_ref ?? null},
        ${JSON.stringify(pnrDetails)},
        ${tripStart.toISOString()},
        ${tripEnd.toISOString()},
        'confirmed',
        ${currency},
        ${JSON.stringify(pricingBreakdown)},
        ${totalAmount}
      )
      RETURNING booking_id
    `

    const bookingId: string = bookingRows[0].booking_id

    // 2. Update chats.itinerary
    await friendDb`
      UPDATE chats
      SET itinerary = ${JSON.stringify({ tab_id, plan, saved_at: new Date().toISOString() })},
          updated_at = NOW()
      WHERE chat_id = ${chat_id}
    `

    return NextResponse.json({ booking_id: bookingId, booking_ref: booking_ref ?? null, ok: true })
  } catch (err) {
    console.error("[itinerary/save]", err)
    const msg = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
