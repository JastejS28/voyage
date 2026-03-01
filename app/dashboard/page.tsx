"use client"

import React, { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Search,
  MapPin,
  Calendar,
  Users,
  Bell,
  TrendingUp,
  XCircle,
  RefreshCw,
  Plane,
  MessageSquarePlus,
  LogOut,
  ChevronRight,
  BookOpen,
  Loader2,
  AlertTriangle,
  PhoneCall,
  Hotel,
} from "lucide-react"
import toast from "react-hot-toast"
import { useChatStore } from "@/store/chat-store"
import { NewChatModal } from "@/components/dashboard/NewChatModal"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { ChatSession } from "@/lib/types"

// ── Mock stats data ──────────────────────────────────────────────────────────
const MOCK_BOOKINGS = { total: 142, active: 38, completed: 96, pending: 8 }
const MOCK_ALERTS = [
  { id: 1, text: "Flight PQ-204 delayed by 3 hours", level: "warn" },
  { id: 2, text: "Hotel Sunrise — check-in overdue", level: "error" },
  { id: 3, text: "2 bookings require payment confirmation", level: "info" },
  { id: 4, text: "New cancellation request from Priya S.", level: "warn" },
]

// Cycles through all chat phases so the sidebar shows variety
const MOCK_STATUS_CYCLE = [
  "booked",
  "itinerary_generated",
  "itinerary_modified",
  "requirement_confirmed",
  "requirement_extracted",
  "itinerary_generating",
  "itinerary_generated",
  "on_hold",
  "didnt_book",
  "chat_started",
]

const DISRUPTION_ALERTS = [
  {
    id: "DIS-001",
    severity: "critical",
    hotel: "Ramada by Wyndham Singapore",
    booking_ref: "BK-KN7AL2",
    customer: "Madhav Kapoor",
    phone: "9876598765",
    affected_dates: "28 Feb 2026 — 04 Mar 2026",
    affected_nights: 5,
    guests: "5 Adults",
    reason: "Prior priority booking conflict — property overcommitted inventory on corporate block allocation",
    hotel_contact: "+65 6337 2200",
    reported_at: "01 Mar 2026, 06:42 AM",
    deadline: "01 Mar 2026, 12:00 PM",
    suggested: [
      { name: "Hotel G Singapore",           stars: 4, price: "\u20B912,000/night", dist: "0.3 km from original" },
      { name: "The Capitol Kempinski Hotel", stars: 5, price: "\u20B938,500/night", dist: "0.6 km from original" },
      { name: "Parkroyal Collection Marina", stars: 5, price: "\u20B934,000/night", dist: "1.1 km from original" },
    ],
  },
]


// -- DB types -------------------------------------------------------------------------
type PricingItem = {
  day: number
  name?: string
  description?: string
  status?: "active" | "cancelled"
  item_id?: string
  category?: string
  type?: string
  amount: number
  currency?: string
}
type CancelGroup = {
  items: Array<{ day: number; name: string; amount: number; item_id: string }>
  cancellation_id: string
  cancelled_scope_amount: number
}
type PnrDay = {
  day: number
  date?: string
  city?: string
  hotel?: { name?: string; star_rating?: string; price_per_night?: { amount: number; currency: string } }
}
type DbBooking = {
  booking_id: string
  provider_booking_id: string
  pnr_details: { days?: PnrDay[]; tab_id?: string; plan_type?: string; summary?: string }
  trip_start_date: string
  trip_end_date: string
  booking_status: string
  currency: string
  pricing_breakdown: PricingItem[]
  total_booking_amount: string | number
  cancelled_items?: CancelGroup[]
  cancelled_amount?: string | number
  refunded_amount?: string | number
  created_at: string
  customer_name?: string
  phone_number?: string
}

// -- Helpers --------------------------------------------------------------------------
function fmtINR(n: number | string): string {
  const num = typeof n === "string" ? parseFloat(n) : n
  if (!num) return "\u20B90"
  return "\u20B9" + num.toLocaleString("en-IN")
}
function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}
function planColor(tab?: string): string {
  switch ((tab ?? "core").toLowerCase()) {
    case "premium": return "bg-[#1A0E05] text-[#C9A84C]"
    case "budget":  return "bg-[#5C4033] text-[#F5EFE6]"
    case "persona": return "bg-[#1A3A5C] text-[#E0F2FF]"
    default:        return "bg-[#3D2814] text-[#F5EFE6]"
  }
}
function isDayCancelled(day: number, pricing: PricingItem[], cancelled?: CancelGroup[] | null): boolean {
  const item = pricing.find(p => p.day === day && (p.category === "hotel" || p.type === "hotel"))
  if (item?.status === "cancelled") return true
  return (cancelled ?? []).some(g => g.items?.some(i => i.day === day))
}
function getHotelItem(day: number, pricing: PricingItem[]): PricingItem | undefined {
  return pricing.find(p => p.day === day && (p.category === "hotel" || p.type === "hotel"))
}
function starCount(s?: string | number): number {
  if (!s) return 0
  if (typeof s === "number") return Math.min(s, 5)
  const m: Record<string, number> = { OneStar: 1, TwoStar: 2, ThreeStar: 3, FourStar: 4, FiveStar: 5 }
  return m[s] ?? (parseInt(s) || 0)
}

type ChatWithStatus = ChatSession & { status?: string }

type DisruptionAlert = {
  id: string; severity: string; hotel: string; booking_ref: string
  customer: string; phone: string; affected_dates: string; affected_nights: number
  guests: string; reason: string; hotel_contact: string; reported_at: string
  deadline: string; suggested: { name: string; stars: number; price: string; dist: string }[]
}

function DisruptionCard({ alert: d }: { alert: DisruptionAlert }) {
  const [dismissed, setDismissed] = useState(false)
  const [selectedAlt, setSelectedAlt] = useState<string | null>(null)
  if (dismissed) return null
  return (
    <div className="col-span-2 rounded-xl overflow-hidden border border-red-300 shadow-lg">
      {/* Header bar */}
      <div className="bg-[#1A0000] px-5 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="relative flex w-2.5 h-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <span className="text-[10px] font-bold tracking-[0.15em] text-red-400 uppercase">Critical Disruption</span>
          <span className="text-[9px] bg-red-900/60 border border-red-700 text-red-300 px-2 py-0.5 rounded font-mono">{d.id}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[9px] text-red-400 font-semibold">Deadline: {d.deadline}</span>
          <button onClick={() => setDismissed(true)} className="text-[9px] text-red-500 hover:text-red-300 transition-colors px-2 py-0.5 border border-red-800 rounded">
            Dismiss
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="bg-[#1C0A00] px-5 py-4 grid grid-cols-3 gap-5">
        {/* Left: hotel info */}
        <div className="col-span-2 space-y-4">
          <div>
            <p className="text-[9px] text-red-400 uppercase tracking-widest font-bold mb-1">Hotel Cancellation Notice</p>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded bg-red-900/50 border border-red-800 flex items-center justify-center flex-shrink-0">
                <Hotel size={14} className="text-red-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">{d.hotel}</p>
                <p className="text-[10px] text-red-300 mt-0.5">{d.reason}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Guest", value: d.customer },
              { label: "Booking Ref", value: d.booking_ref },
              { label: "Contact", value: d.phone },
              { label: "Affected Dates", value: d.affected_dates },
              { label: "Duration", value: `${d.affected_nights} nights` },
              { label: "Guests", value: d.guests },
            ].map(({ label, value }) => (
              <div key={label} className="bg-black/30 border border-red-900/50 rounded-lg px-3 py-2">
                <p className="text-[8px] text-red-500 uppercase tracking-widest mb-0.5">{label}</p>
                <p className="text-[11px] font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button className="flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded bg-[#C9A84C] text-[#1A0A00] hover:bg-[#E0C060] transition-colors">
              Initiate Re-booking
            </button>
            <a href={`tel:${d.hotel_contact}`} className="flex items-center gap-1.5 text-[10px] font-semibold px-3 py-1.5 rounded border border-red-700 text-red-300 hover:bg-red-900/40 transition-colors">
              <PhoneCall size={10} /> Call Hotel {d.hotel_contact}
            </a>
            <span className="ml-auto text-[9px] text-red-600">Reported: {d.reported_at}</span>
          </div>
        </div>

        {/* Right: alternatives */}
        <div>
          <p className="text-[9px] text-[#C9A84C] uppercase tracking-widest font-bold mb-2">Suggested Alternatives</p>
          <div className="space-y-2">
            {d.suggested.map((s) => (
              <button
                key={s.name}
                onClick={() => setSelectedAlt(s.name)}
                className={cn(
                  "w-full text-left rounded-lg border px-3 py-2.5 transition-all",
                  selectedAlt === s.name
                    ? "border-[#C9A84C] bg-[#C9A84C]/10"
                    : "border-red-900/60 bg-black/20 hover:border-red-700"
                )}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-[10px] font-semibold text-white leading-tight">{s.name}</p>
                  <p className="text-[9px] text-[#C9A84C]">{"★".repeat(s.stars)}</p>
                </div>
                <p className="text-[9px] text-green-400 font-semibold">{s.price}</p>
                <p className="text-[8px] text-red-500 mt-0.5">{s.dist}</p>
              </button>
            ))}
          </div>
          {selectedAlt && (
            <button className="mt-2 w-full text-[10px] font-bold px-3 py-1.5 rounded bg-[#C9A84C] text-[#1A0A00] hover:bg-[#E0C060] transition-colors">
              Confirm: {selectedAlt.split(" ").slice(0, 2).join(" ")}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status?: string }) {
  const s = (status ?? "").toLowerCase()
  const map: Record<string, { label: string; cls: string }> = {
    chat_started:             { label: "CHAT STARTED",       cls: "bg-stone-100 text-stone-600 border-stone-300" },
    requirement_extracted:    { label: "REQ EXTRACTED",      cls: "bg-sky-100 text-sky-700 border-sky-200" },
    requirement_confirmed:    { label: "REQ CONFIRMED",      cls: "bg-blue-100 text-blue-700 border-blue-200" },
    itinerary_generating:     { label: "GENERATING",         cls: "bg-amber-100 text-amber-700 border-amber-200" },
    itinerary_generated:      { label: "ITINERARY READY",    cls: "bg-teal-100 text-teal-700 border-teal-200" },
    itinerary_modified:       { label: "MODIFIED",           cls: "bg-violet-100 text-violet-700 border-violet-200" },
    booked:                   { label: "BOOKED",             cls: "bg-green-100 text-green-700 border-green-200" },
    didnt_book:               { label: "DIDN'T BOOK",        cls: "bg-red-100 text-red-600 border-red-200" },
    on_hold:                  { label: "ON HOLD",            cls: "bg-orange-100 text-orange-700 border-orange-200" },
  }
  const cfg = map[s] ?? { label: (status ?? "CHAT").toUpperCase().replace(/_/g, " "), cls: "bg-stone-100 text-stone-600 border-stone-200" }
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border tracking-wide", cfg.cls)}>
      {cfg.label}
    </span>
  )
}

function BookingsSummaryCard({ bookings, loading, onRefresh }: { bookings: DbBooking[], loading: boolean, onRefresh: () => void }) {
  const [open, setOpen] = useState(false)

  const confirmed = bookings.filter(b => b.booking_status === "confirmed").length
  const cancelled = bookings.filter(b => b.booking_status === "cancelled").length
  const total     = bookings.reduce((s, b) => s + parseFloat(String(b.total_booking_amount ?? 0)), 0)

  return (
    <div className="col-span-2 bg-white border border-[#D4C5B0] rounded overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[#FDFAF6] transition-colors text-left"
      >
        <BookOpen size={14} className="text-[#8B6347] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold tracking-widest text-[#3D2814] uppercase">Bookings</p>
          <p className="text-[11px] text-[#8B6347] mt-0.5">
            {loading ? "Loading..." : `${bookings.length} total`}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {loading ? (
            <Loader2 size={14} className="animate-spin text-[#8B6347]" />
          ) : (
            <>
              {confirmed > 0 && (
                <span className="text-[10px] bg-green-50 border border-green-200 text-green-700 font-semibold px-2.5 py-1 rounded-full">
                  {confirmed} Confirmed
                </span>
              )}
              {cancelled > 0 && (
                <span className="text-[10px] bg-red-50 border border-red-200 text-red-700 font-semibold px-2.5 py-1 rounded-full">
                  {cancelled} Cancelled
                </span>
              )}
              <span className="text-sm font-bold text-[#3D2814]">{fmtINR(total)}</span>
            </>
          )}
          <ChevronRight size={13} className={cn("text-[#B09880] transition-transform duration-200", open && "rotate-90")} />
        </div>
      </button>
      {open && (
        <div className="border-t border-[#EDE4D6]">
          <BookingsSection bookings={bookings} loading={loading} onRefresh={onRefresh} />
        </div>
      )}
    </div>
  )
}

type ConfirmState = { bookingId: string; providerBookingId: string; day: number; hotelName: string; amount: number }

function BookingsSection({ bookings, loading, onRefresh }: {
  bookings: DbBooking[]
  loading: boolean
  onRefresh: () => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<ConfirmState | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const handleCancelDay = async () => {
    if (!confirmCancel) return
    setCancelling(true)
    try {
      const res = await fetch("/api/bookings/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider_booking_id: confirmCancel.providerBookingId,
          selected_days: [confirmCancel.day],
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success(`Day ${confirmCancel.day} cancelled successfully`)
      setConfirmCancel(null)
      onRefresh()
    } catch (err) {
      toast.error(`Cancellation failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setCancelling(false)
    }
  }

  if (loading) {
    return (
      <div className="p-10 flex flex-col items-center gap-3 text-[#8B6347]">
        <Loader2 size={24} className="animate-spin" />
        <p className="text-sm">Loading bookings�</p>
      </div>
    )
  }

  if (!bookings.length) {
    return (
      <div className="p-10 text-center text-[#8B6347] text-sm">No bookings found.</div>
    )
  }

  const totalRevenue = bookings.reduce((s, b) => s + parseFloat(String(b.total_booking_amount ?? 0)), 0)
  const confirmedCount = bookings.filter(b => b.booking_status === "confirmed").length
  const cancelledCount = bookings.filter(b => b.booking_status === "cancelled").length

  return (
    <div className="p-6">
      {/* Confirm cancel banner */}
      {confirmCancel && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-red-800">
              Cancel Day {confirmCancel.day} — {confirmCancel.hotelName}?
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              Estimated refund ~{fmtINR(Math.round(confirmCancel.amount * 0.8))} (80% of {fmtINR(confirmCancel.amount)})
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setConfirmCancel(null)}
              className="text-xs px-3 py-1.5 rounded border border-[#D4C5B0] bg-white text-[#5C4033] hover:bg-[#F5EFE6] transition-colors"
            >
              Back
            </button>
            <button
              disabled={cancelling}
              onClick={() => void handleCancelDay()}
              className="text-xs px-3 py-1.5 rounded bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center gap-1.5"
            >
              {cancelling && <Loader2 size={11} className="animate-spin" />}
              Confirm Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-bold text-[#3D2814]">All Bookings</h2>
          <p className="text-[11px] text-[#8B6347] mt-0.5">{bookings.length} bookings · Updated just now</p>
        </div>
        <button
          onClick={onRefresh}
          className="text-[10px] px-2.5 py-1.5 rounded border border-[#D4C5B0] bg-[#F5EFE6] text-[#5C4033] hover:bg-[#EDE4D6] transition-colors flex items-center gap-1"
        >
          <Loader2 size={10} /> Refresh
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "Total Bookings", value: String(bookings.length), color: "text-[#3D2814]", bg: "bg-white" },
          { label: "Total Revenue",  value: fmtINR(totalRevenue),   color: "text-green-700", bg: "bg-green-50" },
          { label: "Confirmed",      value: String(confirmedCount),  color: "text-green-700", bg: "bg-green-50" },
          { label: "Cancelled",      value: String(cancelledCount),  color: "text-red-700",   bg: "bg-red-50" },
        ].map((s) => (
          <div key={s.label} className={cn("rounded-xl border border-[#D4C5B0] p-4", s.bg)}>
            <p className="text-[9px] text-[#8B6347] uppercase tracking-widest mb-1">{s.label}</p>
            <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[#D4C5B0] overflow-hidden bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[#F5EFE6] border-b border-[#D4C5B0]">
              {["Booking Ref", "Customer", "Plan", "Hotel (Day 1)", "Dates", "Total", "Status", ""].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left text-[9px] font-bold text-[#8B6347] uppercase tracking-widest whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => {
              const pnr     = b.pnr_details ?? {}
              const days    = pnr.days ?? []
              const day1    = days.find(d => d.day === 1)
              const hotel1  = day1?.hotel
              const isExpanded = expandedId === b.booking_id
              const statusCls = b.booking_status === "confirmed"
                ? "bg-green-50 border-green-200 text-green-700"
                : b.booking_status === "cancelled"
                  ? "bg-red-50 border-red-200 text-red-700"
                  : "bg-amber-50 border-amber-200 text-amber-700"

              return (
                <React.Fragment key={b.booking_id}>
                  <tr
                    onClick={() => setExpandedId(isExpanded ? null : b.booking_id)}
                    className="border-b border-[#F5EFE6] hover:bg-[#FDFAF6] cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono font-semibold text-[#3D2814]">
                      {b.provider_booking_id}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#3D2814]">{b.customer_name ?? "-"}</p>
                      <p className="text-[10px] text-[#8B6347]">{b.phone_number ?? ""}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("text-[9px] font-bold px-2 py-1 rounded-full", planColor(pnr.tab_id))}>
                        {pnr.plan_type ?? pnr.tab_id ?? "Core"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {hotel1 ? (
                        <>
                          <p className="text-[#3D2814] font-medium leading-tight">{hotel1.name ?? "-"}</p>
                          <p className="text-[10px] text-[#C9A84C]">{"\u2605".repeat(starCount(hotel1.star_rating))}</p>
                        </>
                      ) : <span className="text-[#8B6347]">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[#3D2814] font-medium flex items-center gap-1">
                        <Calendar size={9} className="text-[#8B6347]" />
                        {fmtDate(b.trip_start_date)} to {fmtDate(b.trip_end_date)}
                      </p>
                      <p className="text-[10px] text-[#8B6347] mt-0.5">{days.length} days</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-[#3D2814]">{fmtINR(b.total_booking_amount)}</p>
                      {b.cancelled_amount && parseFloat(String(b.cancelled_amount)) > 0 && (
                        <p className="text-[10px] text-red-600">-{fmtINR(b.cancelled_amount)} cancelled</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("text-[9px] font-semibold px-2 py-1 rounded border capitalize", statusCls)}>
                        {b.booking_status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight size={13} className={cn("text-[#B09880] transition-transform duration-200", isExpanded && "rotate-90")} />
                    </td>
                  </tr>

                  {/* Expanded: per-day hotel cancel cards */}
                  {isExpanded && days.length > 0 && (
                    <tr className="bg-[#FDFAF6]">
                      <td colSpan={8} className="px-6 py-4">
                        <p className="text-[10px] font-bold text-[#8B6347] uppercase tracking-widest mb-3">
                          Hotel Days � click to cancel individual days
                        </p>
                        <div className="grid grid-cols-3 gap-3">
                          {days.map((d) => {
                            const hotel = d.hotel
                            if (!hotel) return null
                            const cancelled = isDayCancelled(d.day, b.pricing_breakdown ?? [], b.cancelled_items)
                            const item      = getHotelItem(d.day, b.pricing_breakdown ?? [])
                            const price     = item?.amount ?? hotel.price_per_night?.amount ?? 0

                            return (
                              <div key={d.day} className={cn(
                                "rounded-xl border p-3 flex flex-col gap-1.5",
                                cancelled
                                  ? "border-red-200 bg-red-50"
                                  : "border-[#D4C5B0] bg-white"
                              )}>
                                <div className="flex items-center justify-between">
                                  <span className="text-[9px] font-bold text-[#8B6347] uppercase tracking-widest">Day {d.day}</span>
                                  {d.date && <span className="text-[9px] text-[#B09880]">{fmtDate(d.date)}</span>}
                                </div>
                                <p className="text-xs font-semibold text-[#3D2814] leading-tight">{hotel.name ?? "-"}</p>
                                {hotel.star_rating && (
                                  <p className="text-[9px] text-[#C9A84C]">{"\u2605".repeat(starCount(hotel.star_rating))}</p>
                                )}
                                <p className="text-[10px] text-[#5C4033]">{fmtINR(price)} / night</p>
                                {cancelled ? (
                                  <span className="mt-1 self-start text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-100 border border-red-200 text-red-700">
                                    Cancelled
                                  </span>
                                ) : (
                                  b.booking_status !== "cancelled" && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setConfirmCancel({
                                          bookingId: b.booking_id,
                                          providerBookingId: b.provider_booking_id,
                                          day: d.day,
                                          hotelName: hotel.name ?? "Hotel",
                                          amount: price,
                                        })
                                      }}
                                      className="mt-1 self-start text-[9px] font-semibold px-2.5 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 transition-colors"
                                    >
                                      Cancel Day {d.day}
                                    </button>
                                  )
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const { chatHistory, setChatHistory, setActiveChatId, resetChat } = useChatStore()
  const [showNewChat, setShowNewChat] = useState(false)
  const [location, setLocation] = useState("")
  const [checkIn, setCheckIn] = useState("")
  const [checkOut, setCheckOut] = useState("")

  // --- bookings (shared between summary card + cancellation/refund panels) ---
  const [bookings, setBookings] = useState<DbBooking[]>([])
  const [bookingsLoading, setBookingsLoading] = useState(true)

  const fetchBookings = useCallback(async () => {
    setBookingsLoading(true)
    try {
      const res = await fetch("/api/bookings")
      if (res.ok) {
        const data = await res.json() as { bookings: DbBooking[] }
        setBookings(data.bookings ?? [])
      }
    } finally { setBookingsLoading(false) }
  }, [])

  useEffect(() => { void fetchBookings() }, [fetchBookings])

  // Show disruption card 20 s after loading the dashboard
  const [showDisruption, setShowDisruption] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShowDisruption(true), 20_000)
    return () => clearTimeout(t)
  }, [])
  const bookingCancels = bookings.flatMap((b) =>
    (b.cancelled_items ?? []).map((cg, i) => ({
      id: `${b.booking_id}-${i}`,
      customer: b.customer_name ?? "-",
      booking: b.provider_booking_id,
      days: (cg.items ?? []).map(it => `Day ${it.day}`).join(", "),
      amount: cg.cancelled_scope_amount,
      date: new Date(b.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    }))
  )

  // Derive refunds from bookings (80% of cancelled_amount)
  const bookingRefunds = bookings
    .filter(b => parseFloat(String(b.refunded_amount ?? 0)) > 0)
    .map(b => ({
      id: b.booking_id,
      customer: b.customer_name ?? "-",
      amount: parseFloat(String(b.refunded_amount)),
      date: new Date(b.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    }))

  useEffect(() => {
    fetch("/api/chats")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setChatHistory(data.chats ?? data ?? []) })
      .catch(console.error)
  }, [setChatHistory])

  function openChat(session: ChatSession) {
    resetChat()
    setActiveChatId(session.chat_id)
    router.push("/chats")
  }

  return (
    <div className="min-h-screen bg-[#F5EFE6] text-[#3D2814]">

      {/* ── Navbar ── */}
      <header className="bg-white border-b border-[#D4C5B0] px-6 h-14 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-[#3D2814] flex items-center justify-center">
            <Plane size={13} className="text-[#F5EFE6]" />
          </div>
          <span className="font-bold text-base tracking-tight text-[#3D2814]">Voyage</span>
        </div>
        <nav className="flex items-center gap-6">
         
          <a href="#" className="text-sm text-[#5C4033] hover:text-[#3D2814] font-medium transition-colors">Logbox</a>
          <a href="#" className="text-sm text-[#5C4033] hover:text-[#3D2814] font-medium transition-colors">Property Links</a>
          <a href="#" className="text-sm text-[#5C4033] hover:text-[#3D2814] font-medium transition-colors">Contact</a>
          <a href="/handler/sign-out" className="flex items-center gap-1.5 text-xs text-[#8B6347] hover:text-[#3D2814] transition-colors">
            <LogOut size={12} /> Sign out
          </a>
        </nav>
      </header>

      {/* ── Hotel & Flight Search ── */}
      <div className="bg-white border-b border-[#D4C5B0] px-6 py-4">
        <p className="text-[9px] font-bold tracking-widest text-[#8B6347] mb-3 uppercase">Hotel and Flight Availability</p>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded border border-[#D4C5B0] bg-[#FDFAF6] px-3 py-2 flex-1 focus-within:border-[#3D2814] transition-colors">
            <MapPin size={14} className="text-[#8B6347] flex-shrink-0" />
            <input
              type="text"
              placeholder="Enter City / Hotel / Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="bg-transparent text-sm outline-none text-[#3D2814] placeholder:text-[#B09880] w-full"
            />
          </div>
          <div className="flex items-center gap-2 rounded border border-[#D4C5B0] bg-[#FDFAF6] px-3 py-2 min-w-[220px] focus-within:border-[#3D2814] transition-colors">
            <Calendar size={14} className="text-[#8B6347] flex-shrink-0" />
            <input
              type="text"
              placeholder="Check In"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
              className="bg-transparent text-sm outline-none text-[#3D2814] placeholder:text-[#B09880] w-20"
            />
            <span className="text-[#B09880] text-sm">—</span>
            <input
              type="text"
              placeholder="Check Out"
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
              className="bg-transparent text-sm outline-none text-[#3D2814] placeholder:text-[#B09880] w-24"
            />
          </div>
          <div className="flex items-center gap-2 rounded border border-[#D4C5B0] bg-[#FDFAF6] px-3 py-2 min-w-[200px]">
            <Users size={14} className="text-[#8B6347] flex-shrink-0" />
            <div>
              <p className="text-[9px] text-[#8B6347] leading-none">Rooms &amp; Guests</p>
              <p className="text-xs text-[#3D2814]">1 Room (2 Adults, 0 Children)</p>
            </div>
          </div>
          <Button className="h-10 px-6 bg-[#3D2814] hover:bg-[#5C4033] text-white rounded-none text-sm font-bold tracking-widest gap-2">
            <Search size={14} /> SEARCH
          </Button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex h-[calc(100vh-112px)]">

        {/* Left: chat list */}
        <aside className="w-72 flex-shrink-0 border-r border-[#D4C5B0] bg-[#FDFAF6] flex flex-col">
          <div className="p-4 border-b border-[#D4C5B0]">
            <Button
              onClick={() => setShowNewChat(true)}
              variant="outline"
              className="w-full rounded-none border-[#3D2814] text-[#3D2814] hover:bg-[#3D2814] hover:text-white text-xs font-bold tracking-widest h-10"
            >
              NEW CHAT
            </Button>
          </div>

          <div className="px-4 pt-4 pb-2 flex-shrink-0">
            <p className="text-[9px] font-bold tracking-widest text-[#8B6347] uppercase">Past Chats</p>
          </div>

          <ScrollArea className="flex-1 px-3 pb-4">
            {chatHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-[#B09880]">
                <MessageSquarePlus size={22} strokeWidth={1.2} />
                <p className="text-xs text-center">No chats yet.<br />Create one above.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(chatHistory as ChatWithStatus[]).map((session, idx) => {
                  const displayStatus = MOCK_STATUS_CYCLE[idx % MOCK_STATUS_CYCLE.length]
                  return (
                  <button
                    key={session.chat_id}
                    onClick={() => openChat(session)}
                    className="w-full text-left rounded border border-[#D4C5B0] bg-white px-3 py-2.5 hover:border-[#3D2814] hover:shadow-sm transition-all group"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <StatusBadge status={displayStatus} />
                      <ChevronRight size={11} className="text-[#B09880] mt-0.5 group-hover:text-[#3D2814] flex-shrink-0" />
                    </div>
                    <p className="text-xs text-[#3D2814] font-medium truncate">
                      {session.customer_name || session.phone_number}
                    </p>
                    {session.last_message && (
                      <p className="text-[10px] text-[#8B6347] truncate">{session.last_message}</p>
                    )}
                    <p className="text-[9px] text-[#B09880] mt-0.5 uppercase tracking-wide">
                      {displayStatus.replace(/_/g, " ")}
                    </p>
                  </button>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        </aside>

        {/* Right: content area */}
        <main className="flex-1 overflow-auto bg-[#F5EFE6]">
            <div className="p-4 grid grid-cols-2 gap-4">

          {/* Total Bookings */}
          <div className="bg-white border border-[#D4C5B0] rounded p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={14} className="text-[#8B6347]" />
              <h3 className="text-[10px] font-bold tracking-widest text-[#3D2814] uppercase">Total Bookings Stats</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 flex-1">
              {[
                { label: "Total",     value: MOCK_BOOKINGS.total,     color: "text-[#3D2814]" },
                { label: "Active",    value: MOCK_BOOKINGS.active,    color: "text-amber-700" },
                { label: "Completed", value: MOCK_BOOKINGS.completed, color: "text-green-700" },
                { label: "Pending",   value: MOCK_BOOKINGS.pending,   color: "text-red-700"   },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-[#FDFAF6] border border-[#EDE4D6] rounded p-3">
                  <p className="text-[9px] text-[#8B6347] uppercase tracking-widest mb-1">{label}</p>
                  <p className={cn("text-3xl font-bold leading-none", color)}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Alerts */}
          <div className="bg-white border border-[#D4C5B0] rounded p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <Bell size={14} className="text-[#8B6347]" />
              <h3 className="text-[10px] font-bold tracking-widest text-[#3D2814] uppercase">Alerts Section</h3>
              <span className="ml-auto text-[9px] bg-red-100 text-red-700 border border-red-200 rounded-full px-2 py-0.5 font-bold">
                {MOCK_ALERTS.length} new
              </span>
            </div>
            <div className="space-y-2 flex-1 overflow-auto">
              {MOCK_ALERTS.map((a) => (
                <div key={a.id} className={cn(
                  "flex items-start gap-2 rounded px-3 py-2 text-xs border",
                  a.level === "error" && "bg-red-50 border-red-200 text-red-800",
                  a.level === "warn"  && "bg-amber-50 border-amber-200 text-amber-800",
                  a.level === "info"  && "bg-blue-50 border-blue-200 text-blue-800",
                )}>
                  <span className="mt-0.5 text-[10px]">{a.level === "error" ? "🔴" : a.level === "warn" ? "🟡" : "🔵"}</span>
                  {a.text}
                </div>
              ))}
            </div>
          </div>

          {/* Disruption Alerts */}
          {showDisruption && DISRUPTION_ALERTS.map((d) => (
            <DisruptionCard key={d.id} alert={d} />
          ))}

          {/* Cancellation */}
          <div className="bg-white border border-[#D4C5B0] rounded p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <XCircle size={14} className="text-[#8B6347]" />
              <h3 className="text-[10px] font-bold tracking-widest text-[#3D2814] uppercase">Cancellation</h3>
              {bookingCancels.length > 0 && (
                <span className="ml-auto text-[9px] bg-red-100 text-red-700 border border-red-200 rounded-full px-2 py-0.5 font-bold">
                  {bookingCancels.length}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto">
              {bookingCancels.length === 0 ? (
                <p className="text-xs text-[#B09880] py-4 text-center">{bookingsLoading ? "Loading..." : "No cancellations"}</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#EDE4D6]">
                      {["Customer","Booking","Days Cancelled","Amount"].map((h) => (
                        <th key={h} className={cn("py-1.5 text-[9px] text-[#8B6347] uppercase tracking-widest font-semibold", h === "Amount" ? "text-right" : "text-left")}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bookingCancels.map((c) => (
                      <tr key={c.id} className="border-b border-[#F5EFE6] hover:bg-[#FDFAF6]">
                        <td className="py-2 text-[#3D2814] font-medium">{c.customer}</td>
                        <td className="py-2 font-mono text-[#5C4033]">{c.booking}</td>
                        <td className="py-2 text-[#8B6347]">{c.days}</td>
                        <td className="py-2 text-right text-red-600 font-semibold">{fmtINR(c.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Refund */}
          <div className="bg-white border border-[#D4C5B0] rounded p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <RefreshCw size={14} className="text-[#8B6347]" />
              <h3 className="text-[10px] font-bold tracking-widest text-[#3D2814] uppercase">Refund</h3>
              {bookingRefunds.length > 0 && (
                <span className="ml-auto text-[9px] bg-green-100 text-green-700 border border-green-200 rounded-full px-2 py-0.5 font-bold">
                  {bookingRefunds.length}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto">
              {bookingRefunds.length === 0 ? (
                <p className="text-xs text-[#B09880] py-4 text-center">{bookingsLoading ? "Loading..." : "No refunds"}</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#EDE4D6]">
                      {["Customer","Booking","Refunded","Cancelled"].map((h) => (
                        <th key={h} className={cn("py-1.5 text-[9px] text-[#8B6347] uppercase tracking-widest font-semibold", h === "Cancelled" ? "text-right" : "text-left")}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bookingRefunds.map((r) => (
                      <tr key={r.id} className="border-b border-[#F5EFE6] hover:bg-[#FDFAF6]">
                        <td className="py-2 text-[#3D2814] font-medium">{r.customer}</td>
                        <td className="py-2 font-mono text-[#5C4033]">{bookings.find(b => b.booking_id === r.id)?.provider_booking_id ?? "-"}</td>
                        <td className="py-2 font-semibold text-green-700">{fmtINR(r.amount)}</td>
                        <td className="py-2 text-right text-red-600">{fmtINR(bookings.find(b => b.booking_id === r.id)?.cancelled_amount ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Bookings — Singapore Itinerary */}
          <BookingsSummaryCard bookings={bookings} loading={bookingsLoading} onRefresh={fetchBookings} />

          </div>{/* end grid */}
        </main>
      </div>

      {showNewChat && (
        <NewChatModal
          onClose={() => setShowNewChat(false)}
          onCreated={() => router.push("/chats")}
        />
      )}
    </div>
  )
}
