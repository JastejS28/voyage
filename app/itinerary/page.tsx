"use client"

import { useState, useCallback, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Plane, Hotel, Utensils, Compass, Clock, MapPin,
  Wallet, Star, ChevronDown, ChevronUp, Loader2,
  Calendar, CheckCircle2, ArrowRight, AlertCircle, Sparkles, Coffee, Sun, Moon, User,
} from "lucide-react"
import { Sidebar } from "@/components/dashboard/Sidebar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { useChatStore } from "@/store/chat-store"
import { cn } from "@/lib/utils"
import toast from "react-hot-toast"

// ─── API Types (matches /generate response shape) ─────────────────────────────

interface FlightSegment {
  airline?: string | null
  flight_number?: string | null
  departure_airport?: string | null
  arrival_airport?: string | null
  departure_time?: string | null
  arrival_time?: string | null
  duration_hours?: number | null
  cabin_class?: string | null
  price?: { amount?: number; currency?: string } | null
  [key: string]: unknown
}

interface HotelInfo {
  name?: string | null
  star_rating?: string | null
  trip_advisor_rating?: number | null
  address?: string | null
  facilities?: string[] | null
  attractions_nearby?: string[] | null
  price_per_night?: { amount?: number; currency?: string } | null
  check_in?: string | null
  check_out?: string | null
  image_url?: string | null
}

interface ActivityInfo {
  name?: string | null
  description?: string | null
  duration_hours?: number | null
  cost?: { amount?: number; currency?: string } | null
  type?: string | null
  [key: string]: unknown
}

interface MealInfo {
  type?: string | null
  restaurant?: string | null
  cuisine?: string | null
  price?: { amount?: number; currency?: string } | null
  [key: string]: unknown
}

interface ItineraryDay {
  day: number
  date: string
  city: string
  flights: FlightSegment[]
  hotel: HotelInfo | null
  activities: ActivityInfo[]
  meals: MealInfo[]
}

interface PlanMetadata {
  comfort_score?: number
  risk_score?: number
  refund_score?: number
  total_travel_time_hours?: number
  total_flights?: number
  total_hotel_nights?: number
}

interface ItineraryPlan {
  plan_type: "core" | "premium" | "budget"
  summary: string
  total_estimated_cost?: { amount: number; currency: string }
  days: ItineraryDay[]
  metadata: PlanMetadata
}

interface GenerateResponse {
  core_itinerary: ItineraryPlan | null
  premium_itinerary: ItineraryPlan | null
  budget_itinerary: ItineraryPlan | null
  errors: string[]
  elapsed_seconds: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function starCount(rating?: string | null): number {
  const map: Record<string, number> = {
    OneStar: 1, TwoStar: 2, ThreeStar: 3, FourStar: 4, FiveStar: 5,
  }
  return rating ? (map[rating] ?? 0) : 0
}

function fmt(amount?: number | null, currency?: string | null): string {
  if (amount == null) return "—"
  const sym = currency === "USD" ? "$" : currency === "INR" ? "₹" : (currency ?? "")
  return `${sym}${amount.toLocaleString()}`
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  } catch { return iso }
}

function MealIcon({ type }: { type?: string | null }) {
  const t = (type ?? "").toLowerCase()
  if (t.includes("breakfast")) return <Coffee size={11} />
  if (t.includes("lunch")) return <Sun size={11} />
  return <Moon size={11} />
}

// ─── Day card ─────────────────────────────────────────────────────────────────

function DayCard({ day, tier }: { day: ItineraryDay; tier: "core" | "premium" | "budget" | "persona" }) {
  const [open, setOpen] = useState(false)
  const isPremium = tier === "premium"

  const S = {
    headerBg: isPremium ? "bg-gradient-to-r from-[#1A0E05] to-[#2C1A0E]" : "bg-[#EDE4D6]",
    border: isPremium ? "border-[#C9A84C]/25" : "border-[#D4C5B0]",
    dayBadge: isPremium ? "bg-[#C9A84C] text-[#1A0E05]" : "bg-[#3D2814] text-[#F5EFE6]",
    title: isPremium ? "text-[#F5EFE6]" : "text-[#3D2814]",
    sub: isPremium ? "text-[#8B6347]" : "text-[#8B6347]",
    accent: isPremium ? "text-[#C9A84C]" : "text-[#8B6347]",
    body: isPremium ? "bg-[#120A02]" : "bg-white",
    text: isPremium ? "text-[#D4C5B0]" : "text-[#5C4033]",
    div: isPremium ? "bg-[#2C1A0E]" : "bg-[#F0EAE0]",
    cardBg: isPremium ? "bg-[#1A0E05]" : "bg-[#FDFAF6]",
    tag: isPremium ? "border-[#2C1A0E] bg-[#2C1A0E] text-[#8B6347]" : "border-[#EDE4D6] bg-[#F5EFE6] text-[#8B6347]",
  }

  const hasContent = day.flights.length > 0 || day.hotel || day.activities.length > 0 || day.meals.length > 0

  return (
    <div className={`rounded-xl border overflow-hidden ${S.border}`}>
      <button
        onClick={() => setOpen(!open)}
        disabled={!hasContent}
        className={`w-full flex items-center justify-between px-4 py-3 ${S.headerBg} transition-opacity hover:opacity-90 disabled:cursor-default`}
      >
        <div className="flex items-center gap-3">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${S.dayBadge}`}>
            DAY {day.day}
          </span>
          <div className="text-left">
            <p className={`text-xs font-semibold ${S.title}`}>{fmtDate(day.date)}</p>
            <p className={`text-[10px] ${S.sub}`}>{day.city}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {day.flights.length > 0 && <Plane size={11} className={S.accent} />}
            {day.hotel && <Hotel size={11} className={S.accent} />}
            {day.activities.length > 0 && <Compass size={11} className={S.accent} />}
            {day.meals.length > 0 && <Utensils size={11} className={S.accent} />}
          </div>
          {hasContent
            ? (open ? <ChevronUp size={13} className={S.accent} /> : <ChevronDown size={13} className={S.accent} />)
            : <span className={`text-[10px] ${S.accent}`}>Transit</span>
          }
        </div>
      </button>

      {open && hasContent && (
        <div className={`px-4 py-4 space-y-4 ${S.body}`}>

          {/* Flights */}
          {day.flights.length > 0 && (
            <section>
              <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5 ${S.accent}`}>
                <Plane size={10} /> Flights
              </p>
              <div className="space-y-2">
                {day.flights.map((f, i) => (
                  <div key={i} className={`rounded-lg border ${S.border} p-3 ${S.cardBg}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`text-xs font-semibold ${S.title}`}>{f.airline ?? "—"} {f.flight_number ?? ""}</span>
                      {f.cabin_class && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${S.tag}`}>{f.cabin_class}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className={`font-medium ${S.text}`}>{f.departure_airport ?? "—"}</span>
                      <ArrowRight size={10} className={S.accent} />
                      <span className={`font-medium ${S.text}`}>{f.arrival_airport ?? "—"}</span>
                      {f.duration_hours != null && <span className={`ml-auto ${S.accent}`}>{f.duration_hours}h</span>}
                    </div>
                    {(f.departure_time || f.arrival_time) && (
                      <p className={`text-[10px] mt-0.5 ${S.accent}`}>
                        {f.departure_time ?? ""}{f.arrival_time ? ` → ${f.arrival_time}` : ""}
                      </p>
                    )}
                    {f.price?.amount != null && (
                      <p className={`text-[10px] mt-1 font-medium ${S.accent}`}>
                        {fmt(f.price.amount, f.price.currency)} / person
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {day.flights.length > 0 && (day.hotel || day.activities.length > 0 || day.meals.length > 0) && (
            <Separator className={S.div} />
          )}

          {/* Hotel */}
          {day.hotel && (
            <section>
              <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5 ${S.accent}`}>
                <Hotel size={10} /> Accommodation
              </p>
              <div className={`rounded-lg border ${S.border} p-3 ${S.cardBg}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold ${S.title}`}>{day.hotel.name ?? "—"}</p>
                    {day.hotel.address && <p className={`text-[10px] mt-0.5 ${S.accent}`}>{day.hotel.address}</p>}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="flex justify-end">
                      {Array.from({ length: starCount(day.hotel.star_rating) }).map((_, i) => (
                        <Star key={i} size={9} className="fill-[#C9A84C] text-[#C9A84C]" />
                      ))}
                    </div>
                    {day.hotel.price_per_night?.amount != null && (
                      <p className={`text-[10px] mt-0.5 font-semibold ${isPremium ? "text-[#C9A84C]" : "text-[#5C4033]"}`}>
                        {fmt(day.hotel.price_per_night.amount, day.hotel.price_per_night.currency)}/night
                      </p>
                    )}
                  </div>
                </div>
                {day.hotel.facilities && day.hotel.facilities.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {day.hotel.facilities.slice(0, 5).map((f, i) => (
                      <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded border ${S.tag}`}>{f}</span>
                    ))}
                    {day.hotel.facilities.length > 5 && (
                      <span className={`text-[9px] px-1.5 py-0.5 ${S.accent}`}>+{day.hotel.facilities.length - 5} more</span>
                    )}
                  </div>
                )}
                {(day.hotel.check_in || day.hotel.check_out) && (
                  <p className={`text-[10px] mt-1.5 ${S.accent}`}>
                    Check-in {day.hotel.check_in ?? "—"} · Check-out {day.hotel.check_out ?? "—"}
                  </p>
                )}
              </div>
            </section>
          )}

          {day.hotel && day.activities.length > 0 && <Separator className={S.div} />}

          {/* Activities */}
          {day.activities.length > 0 && (
            <section>
              <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5 ${S.accent}`}>
                <Compass size={10} /> Activities
              </p>
              <ul className="space-y-2">
                {day.activities.map((a, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${isPremium ? "bg-[#C9A84C]" : "bg-[#8B6347]"}`} />
                    <div>
                      <p className={`text-xs leading-snug ${S.text}`}>{a.name ?? a.description ?? "Activity"}</p>
                      {a.name && a.description && (
                        <p className={`text-[10px] mt-0.5 ${S.accent}`}>{a.description}</p>
                      )}
                      <div className="flex gap-3 mt-0.5">
                        {a.duration_hours != null && (
                          <span className={`text-[10px] flex items-center gap-1 ${S.accent}`}><Clock size={9} />{a.duration_hours}h</span>
                        )}
                        {a.cost?.amount != null && (
                          <span className={`text-[10px] flex items-center gap-1 ${S.accent}`}><Wallet size={9} />{fmt(a.cost.amount, a.cost.currency)}</span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {day.activities.length > 0 && day.meals.length > 0 && <Separator className={S.div} />}

          {/* Meals */}
          {day.meals.length > 0 && (
            <section>
              <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5 ${S.accent}`}>
                <Utensils size={10} /> Meals
              </p>
              <div className="space-y-1.5">
                {day.meals.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className={S.accent}><MealIcon type={m.type} /></span>
                    <span className={`text-xs capitalize ${S.text}`}>{m.type ?? "Meal"}</span>
                    {m.restaurant && <span className={`text-[10px] ${S.accent}`}>· {m.restaurant}</span>}
                    {m.cuisine && <span className={`text-[10px] ${S.accent}`}>· {m.cuisine}</span>}
                    {m.price?.amount != null && (
                      <span className={`text-[10px] ml-auto flex-shrink-0 ${S.accent}`}>{fmt(m.price.amount, m.price.currency)}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Booking Confirmed Overlay ────────────────────────────────────────────────

function BookingConfirmedOverlay({
  bookingRef, plan, tab, onDone,
}: {
  bookingRef: string
  plan: ItineraryPlan
  tab: string
  onDone: () => void
}) {
  const [phase, setPhase] = useState<"enter" | "show" | "exit">("enter")

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("show"), 50)
    const t2 = setTimeout(() => setPhase("exit"), 3000)
    const t3 = setTimeout(() => onDone(), 3600)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const firstDay = plan.days[0]
  const lastDay = plan.days[plan.days.length - 1]
  const cost = plan.total_estimated_cost

  return (
    <div className={cn(
      "fixed inset-0 z-[100] flex items-center justify-center transition-all duration-500",
      phase === "enter" ? "opacity-0 scale-95" : phase === "show" ? "opacity-100 scale-100" : "opacity-0 scale-110",
      "bg-[#0D2137]/90 backdrop-blur-sm"
    )}>
      {/* Particle ring */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 rounded-full animate-ping"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 1.5}s`,
              animationDuration: `${1 + Math.random()}s`,
              backgroundColor: ["#C9A84C", "#4DA3E0", "#7EC8FF", "#F5EFE6"][i % 4],
              opacity: 0.4,
            }}
          />
        ))}
      </div>

      <div className={cn(
        "relative w-full max-w-md mx-4 rounded-3xl border p-8 text-center shadow-2xl transition-all duration-500 delay-100",
        phase === "show" ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0",
        "bg-gradient-to-br from-[#0D2137] to-[#1A3A5C] border-[#4DA3E0]/30"
      )}>
        {/* Checkmark */}
        <div className={cn(
          "w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 transition-all duration-700 delay-200",
          phase === "show" ? "scale-100 opacity-100" : "scale-0 opacity-0",
          "bg-gradient-to-br from-green-400 to-green-600 shadow-lg shadow-green-500/30"
        )}>
          <CheckCircle2 size={40} className="text-white" strokeWidth={2.5} />
        </div>

        {/* Title */}
        <div className={cn(
          "transition-all duration-500 delay-300",
          phase === "show" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
        )}>
          <p className="text-[11px] font-bold tracking-[0.2em] text-[#4DA3E0] uppercase mb-1">Proposal Sent</p>
          <h2 className="text-3xl font-bold text-white mb-1">Booking Confirmed!</h2>
          <p className="text-[#A8C8E0] text-sm">{tab.charAt(0).toUpperCase() + tab.slice(1)} plan proposal saved successfully</p>
        </div>

        {/* Booking ref */}
        <div className={cn(
          "mt-5 rounded-xl bg-[#4DA3E0]/10 border border-[#4DA3E0]/30 px-4 py-3 transition-all duration-500 delay-[400ms]",
          phase === "show" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
        )}>
          <p className="text-[10px] text-[#7EC8FF] font-semibold tracking-widest uppercase mb-1">Booking Reference</p>
          <p className="text-2xl font-mono font-bold text-white tracking-wider">{bookingRef}</p>
        </div>

        {/* Trip details */}
        <div className={cn(
          "mt-4 grid grid-cols-3 gap-3 transition-all duration-500 delay-500",
          phase === "show" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
        )}>
          <div className="rounded-lg bg-white/5 border border-white/10 px-2 py-2">
            <p className="text-[9px] text-[#7EC8FF] uppercase tracking-widest mb-0.5">From</p>
            <p className="text-[11px] font-semibold text-white leading-tight">{firstDay?.city?.split("→")[0]?.split("—")[0]?.trim() ?? "—"}</p>
          </div>
          <div className="rounded-lg bg-white/5 border border-white/10 px-2 py-2">
            <p className="text-[9px] text-[#7EC8FF] uppercase tracking-widest mb-0.5">Nights</p>
            <p className="text-[11px] font-semibold text-white">{plan.days.length - 1}</p>
          </div>
          <div className="rounded-lg bg-white/5 border border-white/10 px-2 py-2">
            <p className="text-[9px] text-[#7EC8FF] uppercase tracking-widest mb-0.5">Total</p>
            <p className="text-[11px] font-semibold text-[#C9A84C]">{fmt(cost?.amount, cost?.currency)}</p>
          </div>
        </div>

        {/* Dates */}
        <div className={cn(
          "mt-3 flex items-center justify-center gap-2 text-[11px] text-[#A8C8E0] transition-all duration-500 delay-[550ms]",
          phase === "show" ? "opacity-100" : "opacity-0"
        )}>
          <Calendar size={11} />
          <span>{fmtDate(firstDay?.date)}</span>
          <ArrowRight size={10} />
          <span>{fmtDate(lastDay?.date)}</span>
        </div>

        {/* Progress bar */}
        <div className="mt-6 h-1 bg-white/10 rounded-full overflow-hidden">
          <div className={cn(
            "h-full bg-gradient-to-r from-[#4DA3E0] to-[#7EC8FF] rounded-full transition-all",
            phase === "show" ? "w-full duration-[2800ms]" : "w-0 duration-0"
          )} />
        </div>
        <p className="text-[10px] text-[#7EC8FF]/60 mt-2">Redirecting to dashboard…</p>
      </div>
    </div>
  )
}

// ─── Score badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ label, value, ring }: { label: string; value?: number; ring: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 ${ring}`}>
        {value ?? "—"}
      </div>
      <span className="text-[9px] text-[#8B6347] text-center leading-tight">{label}</span>
    </div>
  )
}

// ─── Hardcoded Persona Plan ───────────────────────────────────────────────────

const PERSONA_PLAN: ItineraryPlan = {
  plan_type: "core",
  summary: "5-day high-energy leisure trip from India to Singapore for 5 adult males (25–30), covering Universal Studios with Express Passes, Night Safari, Marina Bay Sands, Gardens by the Bay light show, Hawker Centre dining, and shopping at Mustafa Centre and Bugis Street.",
  total_estimated_cost: { amount: 500000, currency: "INR" },
  metadata: { comfort_score: 7, risk_score: 2, refund_score: 6, total_travel_time_hours: 12, total_flights: 2, total_hotel_nights: 4 },
  days: [
    {
      day: 1, date: "2026-02-28", city: "India → Singapore",
      flights: [{ airline: "TBC", flight_number: "TBC", departure_airport: "India — DEL / BOM / BLR", arrival_airport: "Singapore Changi (SIN)", departure_time: "2026-02-28T06:00:00", arrival_time: "2026-02-28T14:00:00", duration_hours: 6, cabin_class: "Economy", price: { amount: 140000, currency: "INR" } }],
      hotel: { name: "4-Star Central Hotel — Clarke Quay / Orchard Road", star_rating: "FourStar", trip_advisor_rating: null, address: "Clarke Quay / Orchard Road, Singapore", facilities: ["Free WiFi", "Breakfast included", "Express check-in", "Concierge", "Air conditioning"], attractions_nearby: ["Clarke Quay Riverside — 0.2 km", "Marina Bay Sands — 2.5 km", "Bugis Street — 3.5 km"], price_per_night: { amount: 60000, currency: "INR" }, check_in: "14:00", check_out: "12:00", image_url: null },
      activities: [
        { name: "Arrival & MaxiCab Transfer to Hotel", type: "logistics", description: "Clear immigration at Changi Airport. Board a pre-booked MaxiCab for comfortable group transfer. Explore Jewel Changi waterfall (HSBC Rain Vortex).", cost: { amount: 3500, currency: "INR" }, duration_hours: 2 },
        { name: "Clarke Quay Evening Walk", type: "leisure", description: "Walk along Clarke Quay riverside — bars, restaurants, and river views for the group's first night. Great photography spot with colourful lights on the river.", cost: { amount: 4000, currency: "INR" }, duration_hours: 3 },
      ],
      meals: [{ type: "dinner", restaurant: "Clarke Quay riverside / hawker stalls", cuisine: "Singaporean / International", price: { amount: 4000, currency: "INR" } }],
    },
    {
      day: 2, date: "2026-03-01", city: "Singapore",
      flights: [],
      hotel: { name: "4-Star Central Hotel — Clarke Quay / Orchard Road", star_rating: "FourStar", trip_advisor_rating: null, address: "Clarke Quay / Orchard Road, Singapore", facilities: ["Free WiFi", "Breakfast included", "Express check-in", "Concierge", "Air conditioning"], attractions_nearby: ["Clarke Quay Riverside — 0.2 km", "Marina Bay Sands — 2.5 km"], price_per_night: { amount: 60000, currency: "INR" }, check_in: "14:00", check_out: "12:00", image_url: null },
      activities: [
        { name: "Universal Studios Singapore — Full Day with Express Passes", type: "theme_park", description: "Full day at USS on Sentosa Island. Express Passes skip queues at Battlestar Galactica, Jurassic World, Transformers, and Revenge of the Mummy. Arrive at opening ~10:00 AM.", cost: { amount: 37500, currency: "INR" }, duration_hours: 10 },
        { name: "Sentosa Island Evening Stroll", type: "leisure", description: "Wind down along Sentosa's beachfront or Resorts World area. Great photo opportunities at golden hour.", cost: { amount: 0, currency: "INR" }, duration_hours: 1.5 },
      ],
      meals: [
        { type: "breakfast", restaurant: "Hotel breakfast (included)", cuisine: null, price: { amount: 0, currency: "INR" } },
        { type: "lunch", restaurant: "Inside Universal Studios Singapore", cuisine: "International / Fast Food", price: { amount: 3500, currency: "INR" } },
        { type: "dinner", restaurant: "Vivocity Mall food court near Harbourfront", cuisine: "Singaporean", price: { amount: 3000, currency: "INR" } },
      ],
    },
    {
      day: 3, date: "2026-03-02", city: "Singapore",
      flights: [],
      hotel: { name: "4-Star Central Hotel — Clarke Quay / Orchard Road", star_rating: "FourStar", trip_advisor_rating: null, address: "Clarke Quay / Orchard Road, Singapore", facilities: ["Free WiFi", "Breakfast included", "Express check-in", "Concierge", "Air conditioning"], attractions_nearby: ["Clarke Quay Riverside — 0.2 km", "Marina Bay Sands — 2.5 km"], price_per_night: { amount: 60000, currency: "INR" }, check_in: "14:00", check_out: "12:00", image_url: null },
      activities: [
        { name: "Haji Lane — Hidden Gem Photography Spot", type: "leisure", description: "Vibrant street art murals, quirky boutiques, and colourful shophouses. Pair with Arab Street for architecture shots.", cost: { amount: 0, currency: "INR" }, duration_hours: 1.5 },
        { name: "Singapore Night Safari", type: "wildlife", description: "Nocturnal wildlife experience — lions, leopards, tapirs, and flying squirrels in natural habitats. Creatures of the Night show is a must-watch.", cost: { amount: 22500, currency: "INR" }, duration_hours: 3.5 },
        { name: "Singapore Zoo (optional daytime add-on)", type: "wildlife", description: "Pair with Singapore Zoo in the afternoon before Night Safari opens at 7:15 PM for a full wildlife day.", cost: { amount: 17500, currency: "INR" }, duration_hours: 4 },
      ],
      meals: [
        { type: "breakfast", restaurant: "Hotel breakfast (included)", cuisine: null, price: { amount: 0, currency: "INR" } },
        { type: "lunch", restaurant: "Tekka Centre Hawker Centre, Little India", cuisine: "Indian / Malay / Singaporean", price: { amount: 2500, currency: "INR" } },
        { type: "dinner", restaurant: "Mandai area food court before Night Safari", cuisine: "Singaporean", price: { amount: 2500, currency: "INR" } },
      ],
    },
    {
      day: 4, date: "2026-03-03", city: "Singapore",
      flights: [],
      hotel: { name: "4-Star Central Hotel — Clarke Quay / Orchard Road", star_rating: "FourStar", trip_advisor_rating: null, address: "Clarke Quay / Orchard Road, Singapore", facilities: ["Free WiFi", "Breakfast included", "Express check-in", "Concierge", "Air conditioning"], attractions_nearby: ["Clarke Quay Riverside — 0.2 km", "Marina Bay Sands — 2.5 km"], price_per_night: { amount: 60000, currency: "INR" }, check_in: "14:00", check_out: "12:00", image_url: null },
      activities: [
        { name: "Marina Bay Sands — SkyPark Observation Deck", type: "sightseeing", description: "Panoramic 360° views of Singapore's skyline. Best at late afternoon for golden hour photography.", cost: { amount: 10000, currency: "INR" }, duration_hours: 2 },
        { name: "Gardens by the Bay — Supertree Grove & Garden Rhapsody Light Show", type: "sightseeing", description: "Walk through Supertree Grove and watch the free Garden Rhapsody light show at 7:45 PM or 8:45 PM.", cost: { amount: 7500, currency: "INR" }, duration_hours: 3.5 },
        { name: "Henderson Waves Bridge — Hidden Gem", type: "leisure", description: "Singapore's highest pedestrian bridge with a wave-like timber structure. Stunning architectural photography.", cost: { amount: 0, currency: "INR" }, duration_hours: 1.5 },
        { name: "Lau Pa Sat — Late Night Satay & Street Food", type: "food", description: "Victorian cast-iron market with outdoor Satay Street — smoky satay grills, cold beer, buzzing atmosphere.", cost: { amount: 3500, currency: "INR" }, duration_hours: 2 },
      ],
      meals: [
        { type: "breakfast", restaurant: "Hotel breakfast (included)", cuisine: null, price: { amount: 0, currency: "INR" } },
        { type: "lunch", restaurant: "Maxwell Food Centre — Tian Tian Hainanese Chicken Rice", cuisine: "Singaporean Hawker", price: { amount: 2500, currency: "INR" } },
        { type: "dinner", restaurant: "Lau Pa Sat Satay Street", cuisine: "Singaporean Street Food", price: { amount: 3500, currency: "INR" } },
      ],
    },
    {
      day: 5, date: "2026-03-04", city: "Singapore → India",
      flights: [{ airline: "TBC", flight_number: "TBC", departure_airport: "Singapore Changi (SIN)", arrival_airport: "India — DEL / BOM / BLR", departure_time: "2026-03-04T20:00:00", arrival_time: "2026-03-04T23:30:00", duration_hours: 5.5, cabin_class: "Economy", price: { amount: 0, currency: "INR" } }],
      hotel: null,
      activities: [
        { name: "Mustafa Centre Shopping — Little India", type: "shopping", description: "24-hour mall for electronics, gold jewellery, groceries, and bargain souvenirs. Best for duty-free shopping.", cost: { amount: 15000, currency: "INR" }, duration_hours: 2.5 },
        { name: "Bugis Street Shopping", type: "shopping", description: "Singapore's busiest street market for budget fashion, accessories, and souvenirs. Haggling accepted.", cost: { amount: 10000, currency: "INR" }, duration_hours: 2 },
      ],
      meals: [
        { type: "breakfast", restaurant: "Hotel breakfast (final morning)", cuisine: null, price: { amount: 0, currency: "INR" } },
        { type: "lunch", restaurant: "Zam Zam Restaurant near Bugis — murtabak and biryani", cuisine: "Indian / Malay", price: { amount: 3000, currency: "INR" } },
        { type: "dinner", restaurant: "Changi Airport food options before departure", cuisine: "International", price: { amount: 4000, currency: "INR" } },
      ],
    },
  ],
}

// ─── Tab config ───────────────────────────────────────────────────────────────

const FULLERTON: HotelInfo = {
  name: "The Fullerton Hotel Singapore",
  star_rating: "FiveStar",
  trip_advisor_rating: 5,
  address: "1 Fullerton Square, Singapore 049178",
  facilities: ["Fine Dining", "Rooftop Pool", "Spa", "Concierge", "Butler Service", "Free WiFi", "Airport Transfer", "Breakfast included"],
  attractions_nearby: ["Marina Bay Sands — 0.8 km", "Gardens by the Bay — 1.2 km", "Clarke Quay — 0.5 km"],
  price_per_night: { amount: 40000, currency: "INR" },
  check_in: "14:00",
  check_out: "12:00",
  image_url: null,
}

type TabId = "core" | "premium" | "budget" | "persona"

const TABS: {
  id: TabId
  label: string
  sublabel: string
  icon: React.ReactNode
  key: string
  activeCls: string
  inactiveCls: string
}[] = [
  {
    id: "core",
    label: "Core",
    sublabel: "Standard plan",
    icon: <CheckCircle2 size={14} />,
    key: "core_itinerary",
    activeCls: "bg-[#3D2814] text-[#F5EFE6] border-[#3D2814]",
    inactiveCls: "bg-white text-[#8B6347] border-[#D4C5B0] hover:border-[#8B6347] hover:text-[#3D2814]",
  },
  {
    id: "premium",
    label: "Premium",
    sublabel: "Luxury plan",
    icon: <Star size={14} />,
    key: "premium_itinerary",
    activeCls: "bg-gradient-to-r from-[#1A0E05] to-[#2C1A0E] text-[#C9A84C] border-[#C9A84C]/60",
    inactiveCls: "bg-white text-[#8B6347] border-[#D4C5B0] hover:border-[#C9A84C]/40 hover:text-[#5C4033]",
  },
  {
    id: "budget",
    label: "Budget",
    sublabel: "Value plan",
    icon: <Wallet size={14} />,
    key: "budget_itinerary",
    activeCls: "bg-[#5C4033] text-[#F5EFE6] border-[#5C4033]",
    inactiveCls: "bg-white text-[#8B6347] border-[#D4C5B0] hover:border-[#5C4033] hover:text-[#3D2814]",
  },
  {
    id: "persona",
    label: "Persona",
    sublabel: "AI-profiled plan",
    icon: <User size={14} />,
    key: "persona_itinerary",
    activeCls: "bg-[#1A3A5C] text-[#E0F2FF] border-[#1A3A5C]",
    inactiveCls: "bg-white text-[#8B6347] border-[#D4C5B0] hover:border-[#1A3A5C]/50 hover:text-[#1A3A5C]",
  },
]

// ─── Streaming simulation messages ────────────────────────────────────────────
const STREAM_MSGS = [
  "Analysing trip requirements...",
  "Searching flights across carriers...",
  "Scanning hotels in the destination...",
  "Drafting Day 1 itinerary...",
  "Drafting Day 2 itinerary...",
  "Drafting Day 3 itinerary...",
  "Drafting Day 4 itinerary...",
  "Pricing Core plan...",
  "Pricing Premium plan...",
  "Pricing Budget plan...",
  "Optimising layovers and in-transit time...",
  "Verifying visa & entry requirements...",
  "Writing activity descriptions and local tips...",
  "Finalising all plans...",
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ItineraryPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { structuredRequirement, activeChatId } = useChatStore()

  const [activeTab, setActiveTab] = useState<TabId>("core")
  const [plans, setPlans] = useState<GenerateResponse | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [queryInputs, setQueryInputs] = useState<Partial<Record<TabId, string>>>({})
  const [upgradedTabs, setUpgradedTabs] = useState<Partial<Record<TabId, boolean>>>({})
  const [savingTabs, setSavingTabs] = useState<Partial<Record<TabId, boolean>>>({})
  const [savedBookings, setSavedBookings] = useState<Partial<Record<TabId, string>>>({})
  const [confirming, setConfirming] = useState<{ bookingRef: string; plan: ItineraryPlan } | null>(null)
  const [streamIdx, setStreamIdx] = useState(0)
  const [streamLines, setStreamLines] = useState<string[]>([])

  // Streaming simulation — cycles through STREAM_MSGS while generating
  useEffect(() => {
    if (!isGenerating) {
      setStreamIdx(0)
      setStreamLines([])
      return
    }
    setStreamLines([STREAM_MSGS[0]])
    setStreamIdx(1)
    const id = setInterval(() => {
      setStreamIdx((prev) => {
        const next = prev + 1
        if (next < STREAM_MSGS.length) {
          setStreamLines((lines) => [...lines, STREAM_MSGS[next]])
        }
        return next
      })
    }, 3200)
    return () => clearInterval(id)
  }, [isGenerating])

  const generate = useCallback(async () => {
    if (!structuredRequirement) {
      toast.error("No structured requirement found. Open a chat first.")
      return
    }
    setIsGenerating(true)
    setGenError(null)
    setPlans(null)
    try {
      const res = await fetch("/api/itinerary/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ structured_requirement: structuredRequirement }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      const data = await res.json() as GenerateResponse
      setPlans(data)
      toast.success(`Generated in ${data.elapsed_seconds?.toFixed(1) ?? "?"}s`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      setGenError(msg)
      toast.error(`Failed: ${msg}`)
    } finally {
      setIsGenerating(false)
    }
  }, [structuredRequirement])

  // Auto-generate when redirected from /chats with ?autoGenerate=true
  useEffect(() => {
    if (searchParams.get("autoGenerate") === "true" && structuredRequirement && !plans && !isGenerating) {
      generate()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generate, searchParams, structuredRequirement])

  const tab = TABS.find((t) => t.id === activeTab)!
  const isUpgraded = upgradedTabs[activeTab] ?? false
  const queryInput = queryInputs[activeTab] ?? ""

  const basePlan: ItineraryPlan | null =
    activeTab === "persona"
      ? PERSONA_PLAN
      : plans
        ? (plans as unknown as Record<string, ItineraryPlan | null>)[tab.key] ?? null
        : null

  const currentPlan: ItineraryPlan | null = isUpgraded && basePlan
    ? {
        ...basePlan,
        total_estimated_cost: basePlan.total_estimated_cost
          ? { amount: basePlan.total_estimated_cost.amount + 60000, currency: basePlan.total_estimated_cost.currency }
          : undefined,
        days: basePlan.days.map((day) =>
          day.day === 4 || day.day === 5 ? { ...day, hotel: FULLERTON } : day
        ),
      }
    : basePlan

  const sendProposal = async () => {
    if (!activeChatId || !currentPlan) {
      toast.error("No active chat or plan — cannot save.")
      return
    }
    setSavingTabs((p) => ({ ...p, [activeTab]: true }))
    const bookingRef = "BK-" + Math.random().toString(36).slice(2, 8).toUpperCase()
    try {
      const res = await fetch("/api/itinerary/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: activeChatId, plan: currentPlan, tab_id: activeTab, booking_ref: bookingRef }),
      })
      const data = await res.json() as { booking_id?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setSavedBookings((p) => ({ ...p, [activeTab]: data.booking_id! }))
      setConfirming({ bookingRef, plan: currentPlan })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSavingTabs((p) => ({ ...p, [activeTab]: false }))
    }
  }

  return (
    <div className="flex h-screen bg-[#F5EFE6] overflow-hidden">

      {/* ── Booking Confirmed overlay ── */}
      {confirming && (
        <BookingConfirmedOverlay
          bookingRef={confirming.bookingRef}
          plan={confirming.plan}
          tab={activeTab}
          onDone={() => { setConfirming(null); localStorage.setItem("voyage_disrupt_pending", "1"); router.push("/dashboard?section=bookings") }}
        />
      )}

      {/* ── Left: existing sidebar (past chats) ── */}
      <Sidebar />

      {/* ── Right: main content ── */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">

        {/* Top header */}
        <header className="flex-shrink-0 h-14 flex items-center justify-between px-6 bg-white border-b border-[#D4C5B0]">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-[#3D2814]">Itinerary Generator</span>
            <span className="text-[10px] bg-[#EDE4D6] text-[#5C4033] border border-[#D4C5B0] rounded-full px-2 py-0.5 font-medium">
              Phase 2
            </span>
            {activeChatId && (
              <>
                <Separator orientation="vertical" className="h-4 bg-[#D4C5B0]" />
                <span className="text-[11px] text-[#8B6347]">
                  Chat <span className="font-mono text-[#3D2814]">{activeChatId.slice(0, 8)}…</span>
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {plans && !isGenerating && (
              <span className="text-[11px] text-green-600 flex items-center gap-1.5">
                <CheckCircle2 size={11} />
                {plans.elapsed_seconds?.toFixed(1)}s · all plans ready
              </span>
            )}
          </div>
        </header>

        {/* 3-tab toggle bar */}
        <div className="flex-shrink-0 flex items-center gap-3 px-6 py-3 bg-[#FDFAF6] border-b border-[#D4C5B0]">
          {TABS.map((t) => {
            const plan: ItineraryPlan | null | undefined =
              t.id === "persona"
                ? PERSONA_PLAN
                : plans?.[t.key as "core_itinerary" | "premium_itinerary" | "budget_itinerary"]
            const isActive = activeTab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={cn(
                  "flex items-center gap-2.5 px-5 py-2.5 rounded-xl border text-xs font-semibold transition-all",
                  isActive ? t.activeCls : t.inactiveCls
                )}
              >
                {t.icon}
                <div className="text-left">
                  <p className="leading-none">{t.label}</p>
                  <p className={cn(
                    "text-[10px] mt-0.5 font-normal leading-none",
                    plan
                      ? isActive ? "opacity-70" : "text-[#5C4033]"
                      : isActive ? "opacity-50" : "text-[#B09880]"
                  )}>
                    {plan
                      ? t.id === "budget"
                        ? ((upgradedTabs["budget"] ? "₹4,10,000" : "₹3,50,000") + " total")
                        : fmt(
                            (plan.total_estimated_cost?.amount ?? 0) + (upgradedTabs[t.id] ? 60000 : 0),
                            plan.total_estimated_cost?.currency
                          ) + " total"
                      : t.sublabel
                    }
                  </p>
                </div>
                {isGenerating && <Loader2 size={10} className="animate-spin ml-1 opacity-50" />}
                {plan && !isGenerating && (
                  <CheckCircle2 size={10} className={cn("ml-1", isActive && t.id === "premium" ? "text-[#C9A84C]" : isActive && t.id === "persona" ? "text-[#4DA3E0]" : "text-green-500")} />
                )}
              </button>
            )
          })}

          {plans?.errors && plans.errors.length > 0 && (
            <div className="ml-auto flex items-center gap-1.5 text-[11px] text-amber-600">
              <AlertCircle size={12} />
              {plans.errors.length} warning{plans.errors.length > 1 ? "s" : ""}
            </div>
          )}
        </div>

        {/* Scrollable content */}
        <ScrollArea className="flex-1">
          <div className="p-6">

            {/* No structured requirement */}
            {activeTab !== "persona" && !structuredRequirement && !isGenerating && !plans && (
              <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
                <div className="w-16 h-16 rounded-2xl bg-[#EDE4D6] flex items-center justify-center">
                  <MapPin size={28} strokeWidth={1.2} className="text-[#8B6347]" />
                </div>
                <p className="text-sm font-semibold text-[#3D2814]">No trip requirements loaded</p>
                <p className="text-xs text-[#8B6347] max-w-xs">
                  Open a chat, complete the conversation to extract requirements, then return here to generate itineraries.
                </p>
                <button
                  onClick={() => router.push("/chats")}
                  className="mt-2 px-4 py-2 rounded-lg bg-[#3D2814] text-[#F5EFE6] text-xs font-semibold hover:bg-[#5C4033] transition-colors"
                >
                  Go to Chats
                </button>
              </div>
            )}

            {/* Has SR, not yet generated */}
            {activeTab !== "persona" && structuredRequirement && !isGenerating && !plans && !genError && (
              <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
                <div className="w-16 h-16 rounded-2xl bg-[#EDE4D6] flex items-center justify-center">
                  <Sparkles size={26} strokeWidth={1.2} className="text-[#8B6347]" />
                </div>
                <p className="text-sm font-semibold text-[#3D2814]">Ready to generate</p>
                <p className="text-xs text-[#8B6347] max-w-xs">
                  Trip requirements loaded. Click &ldquo;Generate Itinerary&rdquo; to create Core, Premium &amp; Budget plans in parallel.
                </p>
                <p className="text-[10px] text-[#B09880]">Usually takes 1–2 minutes</p>
              </div>
            )}

            {/* Generating */}
            {activeTab !== "persona" && isGenerating && (
              <div className="flex flex-col items-center justify-center py-12 gap-6">
                {/* Spinner */}
                <div className="relative">
                  <div className="w-16 h-16 rounded-full border-2 border-[#EDE4D6] flex items-center justify-center">
                    <Sparkles size={22} className="text-[#8B6347]" />
                  </div>
                  <div className="absolute inset-0 rounded-full border-2 border-[#3D2814]/20 animate-spin border-t-[#3D2814]" />
                </div>

                {/* Header */}
                <div className="text-center">
                  <p className="text-sm font-semibold text-[#3D2814]">Generating 3 itineraries in parallel…</p>
                  <p className="text-xs text-[#8B6347] mt-1">Core, Premium, and Budget plans are being created simultaneously</p>
                </div>

                {/* Streaming log */}
                <div className="w-full max-w-md space-y-1.5">
                  {streamLines.map((line, i) => (
                    <div key={i} className={cn(
                      "flex items-center gap-2 text-xs transition-all duration-300",
                      i === streamLines.length - 1 ? "text-[#3D2814]" : "text-[#B09880]"
                    )}>
                      {i === streamLines.length - 1
                        ? <span className="w-1.5 h-1.5 rounded-full bg-[#3D2814] animate-pulse flex-shrink-0" />
                        : <span className="w-1.5 h-1.5 rounded-full bg-[#D4C5B0] flex-shrink-0" />}
                      {line}
                    </div>
                  ))}
                </div>

                {/* Plan badges */}
                <div className="flex items-center gap-5">
                  {TABS.map((t) => (
                    <div key={t.id} className="flex items-center gap-1.5 text-[11px] text-[#8B6347]">
                      <Loader2 size={11} className="animate-spin" />
                      {t.label}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error */}
            {activeTab !== "persona" && genError && !isGenerating && (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center">
                  <AlertCircle size={24} className="text-red-500" />
                </div>
                <p className="text-sm font-semibold text-[#3D2814]">Generation failed</p>
                <p className="text-xs text-[#8B6347] max-w-xs text-center">{genError}</p>
                <button
                  onClick={generate}
                  className="mt-2 px-4 py-2 rounded-lg bg-[#3D2814] text-[#F5EFE6] text-xs font-semibold hover:bg-[#5C4033]"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Plans loaded — show selected */}
            {(activeTab === "persona" || (plans && !isGenerating)) && (
              <div className="space-y-5">

                {!currentPlan ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center gap-2">
                    <AlertCircle size={22} className="text-amber-500" />
                    <p className="text-sm font-semibold text-[#3D2814]">{tab.label} plan unavailable</p>
                    <p className="text-xs text-[#8B6347]">
                      {plans?.errors && plans.errors.length > 0 ? plans.errors.join(", ") : "The backend did not return this plan."}
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Summary card */}
                    <div className={cn(
                      "rounded-2xl border p-5",
                      activeTab === "premium"
                        ? "bg-gradient-to-br from-[#1A0E05] to-[#2C1A0E] border-[#C9A84C]/30"
                        : activeTab === "persona"
                        ? "bg-gradient-to-br from-[#0D2137] to-[#1A3A5C] border-[#2D6A9F]/30"
                        : "bg-white border-[#D4C5B0]"
                    )}>
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className={cn(
                              "text-[10px] font-bold px-2.5 py-1 rounded-full",
                              activeTab === "premium"
                                ? "bg-[#C9A84C]/20 text-[#C9A84C] border border-[#C9A84C]/30"
                                : activeTab === "persona"
                                ? "bg-[#2D6A9F]/20 text-[#7EC8FF] border border-[#2D6A9F]/30"
                                : "bg-[#EDE4D6] text-[#3D2814] border border-[#D4C5B0]"
                            )}>
                              {tab.label.toUpperCase()} PLAN
                            </span>
                            <span className={cn(
                              "text-lg font-bold",
                              activeTab === "premium" ? "text-[#C9A84C]" : activeTab === "persona" ? "text-[#7EC8FF]" : "text-[#3D2814]"
                            )}>
                              {activeTab === "budget"
                                ? (isUpgraded ? "₹4,10,000" : "₹3,50,000")
                                : fmt(currentPlan.total_estimated_cost?.amount, currentPlan.total_estimated_cost?.currency)}
                            </span>
                            <span className={cn("text-xs", activeTab === "premium" ? "text-[#8B6347]" : "text-[#8B6347]")}>
                              total
                            </span>
                          </div>
                          <p className={cn("text-sm leading-relaxed", activeTab === "premium" ? "text-[#D4C5B0]" : activeTab === "persona" ? "text-[#A8C8E0]" : "text-[#5C4033]")}>
                            {currentPlan.summary}
                          </p>
                        </div>

                        {/* Scores */}
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <ScoreBadge
                            label="Comfort"
                            value={currentPlan.metadata?.comfort_score}
                            ring={activeTab === "premium" ? "border-[#C9A84C] text-[#C9A84C]" : activeTab === "persona" ? "border-[#4DA3E0] text-[#4DA3E0]" : "border-[#3D2814] text-[#3D2814]"}
                          />
                          <ScoreBadge
                            label="Refund"
                            value={currentPlan.metadata?.refund_score}
                            ring="border-green-500 text-green-600"
                          />
                          <ScoreBadge
                            label="Risk"
                            value={currentPlan.metadata?.risk_score}
                            ring="border-amber-500 text-amber-600"
                          />
                        </div>
                      </div>

                      {/* Metadata row */}
                      {currentPlan.metadata && (
                        <div className={cn(
                          "flex items-center gap-5 mt-4 pt-4 border-t flex-wrap",
                          activeTab === "premium" ? "border-[#2C1A0E]" : activeTab === "persona" ? "border-[#1A3A5C]" : "border-[#EDE4D6]"
                        )}>
                          {[
                            { icon: <Calendar size={11} />, v: `${currentPlan.days.length} days` },
                            { icon: <Plane size={11} />, v: `${currentPlan.metadata.total_flights ?? 0} flights` },
                            { icon: <Hotel size={11} />, v: `${currentPlan.metadata.total_hotel_nights ?? 0} nights` },
                            { icon: <Clock size={11} />, v: `${currentPlan.metadata.total_travel_time_hours?.toFixed(1) ?? "—"}h travel` },
                          ].map((s, i) => (
                            <span key={i} className="flex items-center gap-1.5 text-[11px] text-[#8B6347]">
                              {s.icon}{s.v}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Day accordion */}
                    <div className="space-y-2">
                      {currentPlan.days.map((day) => (
                        <DayCard key={day.day} day={day} tier={activeTab} />
                      ))}
                    </div>

                    {/* Query box */}
                    <div className={cn(
                      "rounded-2xl border p-5",
                      isUpgraded
                        ? activeTab === "persona"
                          ? "bg-gradient-to-br from-[#0D2137] to-[#1A3A5C] border-[#2D6A9F]/30"
                          : activeTab === "premium"
                          ? "bg-gradient-to-br from-[#1A0E05] to-[#2C1A0E] border-[#C9A84C]/30"
                          : "bg-[#F0F9F0] border-[#B8DDB8]"
                        : "bg-white border-[#D4C5B0]"
                    )}>
                      <p className={cn(
                        "text-xs font-semibold mb-3",
                        isUpgraded
                          ? activeTab === "persona" ? "text-[#7EC8FF]" : activeTab === "premium" ? "text-[#C9A84C]" : "text-green-700"
                          : "text-[#3D2814]"
                      )}>
                        Ask a modification query
                      </p>
                      {isUpgraded ? (
                        <div className="space-y-3">
                          <div className="flex items-start gap-2.5">
                            <div className={cn(
                              "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5",
                              activeTab === "persona" ? "bg-[#2D6A9F]/30" : "bg-[#EDE4D6]"
                            )}>
                              <User size={11} className={activeTab === "persona" ? "text-[#7EC8FF]" : "text-[#5C4033]"} />
                            </div>
                            <div className={cn(
                              "flex-1 rounded-xl border px-3 py-2",
                              activeTab === "persona" ? "bg-[#1A3A5C] border-[#2D6A9F]/30" : "bg-[#FDFAF6] border-[#D4C5B0]"
                            )}>
                              <p className={cn("text-xs", activeTab === "persona" ? "text-[#A8C8E0]" : "text-[#5C4033]")}>{queryInput}</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2.5">
                            <div className={cn(
                              "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5",
                              activeTab === "persona" ? "bg-[#4DA3E0]/20" : "bg-[#EDE4D6]"
                            )}>
                              <Sparkles size={11} className={activeTab === "persona" ? "text-[#4DA3E0]" : "text-[#8B6347]"} />
                            </div>
                            <div className={cn(
                              "flex-1 rounded-xl border px-3 py-2 space-y-1",
                              activeTab === "persona" ? "bg-[#0D2137] border-[#2D6A9F]/20" : "bg-[#FDFAF6] border-[#D4C5B0]"
                            )}>
                              <p className={cn("text-xs font-semibold", activeTab === "persona" ? "text-[#7EC8FF]" : "text-green-700")}>Hotel upgrade applied ✓</p>
                              <p className={cn("text-[11px]", activeTab === "persona" ? "text-[#A8C8E0]" : "text-[#5C4033]")}>
                                Days 4 &amp; 5 hotel updated to{" "}
                                <span className={cn("font-semibold", activeTab === "persona" ? "text-[#7EC8FF]" : "text-[#3D2814]")}>
                                  The Fullerton Hotel Singapore
                                </span>{" "}
                                (5★) at ₹40,000/night. Total cost revised to{" "}
                                <span className="font-semibold">
                                  {activeTab === "budget" ? "₹4,10,000" : fmt((basePlan?.total_estimated_cost?.amount ?? 0) + 60000, basePlan?.total_estimated_cost?.currency)}
                                </span>.
                              </p>

                              {/* Full updated itinerary breakdown */}
                              <div className={cn(
                                "mt-3 rounded-lg border divide-y text-[10px]",
                                activeTab === "persona" ? "border-[#2D6A9F]/30 divide-[#2D6A9F]/20" : "border-[#D4C5B0] divide-[#EDE4D6]"
                              )}>
                                <p className={cn("px-2.5 py-1.5 font-semibold tracking-wide", activeTab === "persona" ? "text-[#7EC8FF]" : "text-[#3D2814]")}>FULL UPDATED ITINERARY</p>
                                {currentPlan?.days.map((d) => {
                                  const upgraded = d.day === 4 || d.day === 5
                                  return (
                                    <div key={d.day} className="flex items-start gap-2 px-2.5 py-1.5">
                                      <span className={cn(
                                        "flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center font-bold text-[9px]",
                                        upgraded
                                          ? activeTab === "persona" ? "bg-[#4DA3E0]/30 text-[#7EC8FF]" : "bg-green-100 text-green-700"
                                          : activeTab === "persona" ? "bg-[#2D6A9F]/20 text-[#A8C8E0]" : "bg-[#EDE4D6] text-[#5C4033]"
                                      )}>{d.day}</span>
                                      <div className="flex-1 min-w-0">
                                        <span className={cn(
                                          "font-semibold",
                                          activeTab === "persona" ? "text-[#A8C8E0]" : "text-[#3D2814]"
                                        )}>{d.city}</span>
                                        {d.hotel && (
                                          <span className={cn(
                                            "ml-1.5",
                                            upgraded
                                              ? activeTab === "persona" ? "text-[#7EC8FF] font-semibold" : "text-green-700 font-semibold"
                                              : activeTab === "persona" ? "text-[#A8C8E0]/70" : "text-[#8B6347]"
                                          )}>
                                            • {d.hotel.name ?? "Hotel"}{upgraded ? " ⬆️" : ""}
                                          </span>
                                        )}
                                        {d.flights.length > 0 && (
                                          <span className={cn("ml-1.5", activeTab === "persona" ? "text-[#7EC8FF]/60" : "text-[#8B6347]")}>
                                            • {d.flights.length} flight{d.flights.length > 1 ? "s" : ""}
                                          </span>
                                        )}
                                        {d.activities.length > 0 && (
                                          <span className={cn("ml-1.5", activeTab === "persona" ? "text-[#A8C8E0]/70" : "text-[#8B6347]")}>
                                            • {d.activities.length} activit{d.activities.length > 1 ? "ies" : "y"}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={queryInput}
                            onChange={(e) => setQueryInputs((prev) => ({ ...prev, [activeTab]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && queryInput.trim()) {
                                setUpgradedTabs((prev) => ({ ...prev, [activeTab]: true }))
                              }
                            }}
                            className="flex-1 text-xs px-3 py-2 rounded-lg border border-[#D4C5B0] bg-[#FDFAF6] text-[#3D2814] placeholder:text-[#B09880] focus:outline-none focus:ring-2 focus:ring-[#3D2814]/20 focus:border-[#3D2814]"
                          />
                          <button
                            onClick={() => { if (queryInput.trim()) setUpgradedTabs((prev) => ({ ...prev, [activeTab]: true })) }}
                            className={cn(
                              "px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex-shrink-0",
                              activeTab === "premium"
                                ? "bg-[#C9A84C] text-[#1A0E05] hover:bg-[#D4B85C]"
                                : activeTab === "persona"
                                ? "bg-[#1A3A5C] text-[#E0F2FF] hover:bg-[#2D6A9F]"
                                : "bg-[#3D2814] text-[#F5EFE6] hover:bg-[#5C4033]"
                            )}
                          >
                            Apply
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Send proposal footer */}
                    <div className={cn(
                      "rounded-2xl border p-5 flex items-center justify-between gap-4",
                      activeTab === "premium"
                        ? "bg-gradient-to-r from-[#1A0E05] to-[#2C1A0E] border-[#C9A84C]/30"
                        : activeTab === "persona"
                        ? "bg-gradient-to-r from-[#0D2137] to-[#1A3A5C] border-[#2D6A9F]/30"
                        : "bg-white border-[#D4C5B0]"
                    )}>
                      <div>
                        <p className={cn("text-sm font-semibold", activeTab === "premium" || activeTab === "persona" ? "text-[#F5EFE6]" : "text-[#3D2814]")}>
                          {savedBookings[activeTab] ? (
                            <span className="flex items-center gap-1.5">
                              <CheckCircle2 size={13} className="text-green-400" />
                              Proposal sent — Booking {savedBookings[activeTab]!.slice(0, 8)}…
                            </span>
                          ) : (
                            `Send ${tab.label} proposal to customer?`
                          )}
                        </p>
                        <p className="text-xs text-[#8B6347] mt-0.5">
                          Total cost: {activeTab === "budget" ? (isUpgraded ? "₹4,10,000" : "₹3,50,000") : fmt(currentPlan.total_estimated_cost?.amount, currentPlan.total_estimated_cost?.currency)}
                        </p>
                      </div>
                      <button
                        onClick={sendProposal}
                        disabled={!!savedBookings[activeTab] || !!savingTabs[activeTab]}
                        className={cn(
                          "px-5 py-2.5 rounded-xl text-xs font-semibold transition-all flex-shrink-0 flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed",
                          activeTab === "premium"
                            ? "bg-[#C9A84C] text-[#1A0E05] hover:bg-[#D4B85C]"
                            : activeTab === "budget"
                            ? "bg-[#5C4033] text-[#F5EFE6] hover:bg-[#6B4A2A]"
                            : activeTab === "persona"
                            ? "bg-[#4DA3E0] text-[#0D2137] hover:bg-[#6BB8EA]"
                            : "bg-[#3D2814] text-[#F5EFE6] hover:bg-[#5C4033]"
                        )}
                      >
                        {savingTabs[activeTab] && <Loader2 size={11} className="animate-spin" />}
                        {savedBookings[activeTab] ? "Sent ✓" : `Send ${tab.label} Proposal`}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
