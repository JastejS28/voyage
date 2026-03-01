"use client"

import { useState, useCallback } from "react"
import { Edit2, Check, X, ChevronDown, ChevronUp, Plus } from "lucide-react"
import toast from "react-hot-toast"
import { useChatStore } from "@/store/chat-store"
import { formatKey } from "@/lib/utils"
import type { StructuredRequirement } from "@/lib/types"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SENTINELS = new Set(["unknown", "none", "n/a", "", "any"])

function isSentinel(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return true
  if (typeof v === "string" && SENTINELS.has(v.toLowerCase().trim())) return true
  if (Array.isArray(v) && v.length === 0) return true
  return false
}

function sectionHasContent(obj: unknown): boolean {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false
  return Object.values(obj as Record<string, unknown>).some((v) => !isSentinel(v))
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

// ─── Section label map (ordered) ──────────────────────────────────────────────
const SECTION_ORDER = [
  "trip_overview",
  "route_plan",
  "travelers",
  "dates",
  "budget",
  "transport_preferences",
  "stay_preferences",
  "activities",
  "food_preferences",
  "documents_and_constraints",
  "extracted_facts",
  "implied_inferences",
] as const

const SECTION_LABELS: Record<string, string> = {
  trip_overview: "Trip Overview",
  route_plan: "Route Plan",
  travelers: "Travelers",
  dates: "Dates",
  budget: "Budget",
  transport_preferences: "Transport",
  stay_preferences: "Stay Preferences",
  activities: "Activities",
  food_preferences: "Food Preferences",
  documents_and_constraints: "Constraints",
  extracted_facts: "Extracted Facts",
  implied_inferences: "Inferences",
}

// ─── Chip/array editor ────────────────────────────────────────────────────────
function ArrayEditor({
  values,
  onChange,
}: {
  values: string[]
  onChange: (v: string[]) => void
}) {
  const [draft, setDraft] = useState("")

  function addItem() {
    const trimmed = draft.trim()
    if (trimmed) { onChange([...values, trimmed]); setDraft("") }
  }

  return (
    <div className="flex-1">
      <div className="flex flex-wrap gap-1 mb-1.5">
        {values.map((v, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
          >
            {v}
            <button
              onClick={() => onChange(values.filter((_, idx) => idx !== i))}
              className="text-blue-400 hover:text-red-500 ml-0.5"
            >
              <X size={9} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem() } }}
          placeholder="Add item, press Enter…"
          className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
        />
        <button
          onClick={addItem}
          className="p-1 rounded border border-gray-200 text-gray-500 hover:text-blue-600 hover:border-blue-300 bg-white"
        >
          <Plus size={11} />
        </button>
      </div>
    </div>
  )
}

// ─── Field row ─────────────────────────────────────────────────────────────────
type FieldValue = string | number | boolean | null | undefined | string[]

function FieldRow({
  label,
  value,
  editMode,
  onChange,
}: {
  label: string
  value: unknown
  editMode: boolean
  onChange: (v: FieldValue) => void
}) {
  const isArr = Array.isArray(value)
  const isObj = typeof value === "object" && !isArr && value !== null

  // Skip objects (handled by parent as array-of-objects sections)
  if (isObj) return null

  if (isArr) {
    // Only handle string/number arrays as editable chips
    const arr = (value as unknown[]).filter((v) => typeof v === "string" || typeof v === "number")
    if (arr.length === 0 && !editMode) return null

    return (
      <div className="flex items-start gap-2 py-1.5 border-b border-gray-100 last:border-0">
        <span className="text-xs text-gray-400 w-36 flex-shrink-0 pt-0.5">{formatKey(label)}</span>
        {editMode ? (
          <ArrayEditor
            values={arr.map(String)}
            onChange={(newArr) => onChange(newArr)}
          />
        ) : (
          <div className="flex flex-wrap gap-1">
            {arr.map((item, i) => (
              <span key={i} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 font-medium">
                {String(item)}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Scalar
  const scalar = value as string | number | boolean | null | undefined
  const displayVal = scalar === null || scalar === undefined ? "" : String(scalar)

  if (!editMode && isSentinel(scalar)) return null

  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-400 w-36 flex-shrink-0">{formatKey(label)}</span>
      {editMode ? (
        <input
          type={typeof scalar === "number" ? "number" : "text"}
          value={displayVal}
          onChange={(e) =>
            onChange(typeof scalar === "number" ? Number(e.target.value) : e.target.value)
          }
          placeholder={`Enter ${formatKey(label).toLowerCase()}…`}
          className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
        />
      ) : (
        <span className="flex-1 text-xs text-gray-800">{displayVal}</span>
      )}
    </div>
  )
}

// ─── Fact row (array-of-objects like extracted_facts) ─────────────────────────
function FactRow({ item }: { item: Record<string, unknown> }) {
  const text = String(item.fact ?? item.inference ?? Object.values(item)[0] ?? "")
  const confidence = String(item.confidence ?? "")
  const badgeCls =
    confidence === "high"
      ? "bg-green-50 text-green-700"
      : confidence === "medium"
      ? "bg-yellow-50 text-yellow-700"
      : "bg-gray-100 text-gray-500"

  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-gray-100 last:border-0">
      {confidence && (
        <span className={`flex-shrink-0 mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${badgeCls}`}>
          {confidence}
        </span>
      )}
      <span className="text-xs text-gray-700 leading-relaxed">{text}</span>
    </div>
  )
}

// ─── Collapsible section wrapper ──────────────────────────────────────────────
function Section({
  label,
  children,
  defaultOpen = true,
}: {
  label: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
      >
        {label}
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && <div className="px-4 pb-2">{children}</div>}
    </div>
  )
}

// ─── Build a human-readable diff message for the LLM ─────────────────────────

function buildEditMessage(
  original: StructuredRequirement,
  updated: StructuredRequirement
): string {
  const lines: string[] = [
    "The travel agent has manually reviewed and corrected the trip requirements.",
    "Please save and use the following updated requirements as the final source of truth:",
    "",
  ]

  for (const sectionKey of SECTION_ORDER) {
    const orig = original[sectionKey]
    const upd = updated[sectionKey]
    if (!upd || typeof upd !== "object") continue

    if (Array.isArray(upd)) {
      const origArr = JSON.stringify(orig ?? [])
      const updArr = JSON.stringify(upd)
      if (origArr !== updArr) {
        lines.push(`${SECTION_LABELS[sectionKey] ?? sectionKey}: ${updArr}`)
      }
      continue
    }

    const section = upd as Record<string, unknown>
    const origSection = (orig ?? {}) as Record<string, unknown>
    const changedFields: string[] = []

    for (const [field, val] of Object.entries(section)) {
      const origVal = origSection[field]
      if (JSON.stringify(origVal) !== JSON.stringify(val) && !isSentinel(val)) {
        changedFields.push(`  ${formatKey(field)}: ${Array.isArray(val) ? (val as string[]).join(", ") : String(val)}`)
      }
    }

    if (changedFields.length > 0) {
      lines.push(`${SECTION_LABELS[sectionKey] ?? sectionKey}:`)
      lines.push(...changedFields)
    }
  }

  if (lines.length <= 3) {
    // No detected diff — send full JSON so LLM has full context
    lines.push("Full updated requirements:")
    lines.push(JSON.stringify(updated, null, 2))
  }

  return lines.join("\n")
}


interface Props {
  requirement: StructuredRequirement
}

export function RequirementsCard({ requirement }: Props) {
  const { activeChatId, addMessage, isSendingMessage, setIsSendingMessage, setStructuredRequirement } =
    useChatStore()

  const [isEditing, setIsEditing] = useState(false)
  const [edited, setEdited] = useState<StructuredRequirement>(() => deepClone(requirement))

  const updateField = useCallback(
    (section: string, field: string, value: FieldValue) => {
      setEdited((prev) => ({
        ...prev,
        [section]: {
          ...(prev[section] as Record<string, unknown> ?? {}),
          [field]: value,
        },
      }))
    },
    []
  )

  async function submitEdited() {
    if (!activeChatId || isSendingMessage) return
    setIsSendingMessage(true)

    // Build a descriptive message so the LLM receives the actual edited values
    const editMessage = buildEditMessage(requirement, edited)

    try {
      const res = await fetch(`/api/chats/${activeChatId}/flow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: editMessage,
          edited_structured_requirement: edited,
        }),
      })
      if (!res.ok) { toast.error("Failed to submit changes"); return }

      const data = await res.json()
      const newReq: StructuredRequirement | null =
        data.chat?.structured_requirement ?? data.structured_requirement ?? null

      const agentMessages: Array<{ type: string; content: string }> =
        data.chat?.agent_response?.messages ?? []
      const lastAiText =
        agentMessages
          .filter((m) => m.type === "ai" && m.content?.trim())
          .at(-1)?.content ?? null
      const cleanedReply = lastAiText
        ?.replace(/^```[\w]*\n?/m, "").replace(/\n?```$/m, "").trim() ?? null
      let isJson = false
      if (cleanedReply) { try { JSON.parse(cleanedReply); isJson = true } catch { /* ok */ } }
      const replyText =
        data.reply ?? data.response ?? data.message ??
        (!isJson ? cleanedReply : null) ??
        "Requirements updated."

      addMessage({
        id: `usr-edit-${Date.now()}`,
        chat_id: activeChatId,
        role: "user",
        content: "✏️ Manually edited requirements",
        created_at: new Date().toISOString(),
      })
      addMessage({
        id: `ai-edit-${Date.now()}`,
        chat_id: activeChatId,
        role: "assistant",
        content: replyText,
        created_at: new Date().toISOString(),
      })
      if (newReq) {
        setStructuredRequirement(newReq)
        addMessage({
          id: `struct-edit-${Date.now()}`,
          chat_id: activeChatId,
          role: "assistant",
          content: "",
          structuredData: newReq,
          created_at: new Date().toISOString(),
        })
      }
      setIsEditing(false)
      toast.success("Requirements updated!")
    } catch (err) {
      console.error("[RequirementsCard] submit:", err)
      toast.error("Network error")
    } finally {
      setIsSendingMessage(false)
    }
  }

  const data = isEditing ? edited : requirement

  return (
    <div className="w-full max-w-[92%] rounded-xl border border-blue-100 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100">
        <span className="text-xs font-bold text-blue-800 tracking-wide uppercase">
          Trip Requirements
        </span>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <button
                onClick={() => { setEdited(deepClone(requirement)); setIsEditing(false) }}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded border border-gray-200 bg-white"
              >
                <X size={11} /> Cancel
              </button>
              <button
                onClick={submitEdited}
                disabled={isSendingMessage}
                className="flex items-center gap-1 text-xs text-white bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded disabled:opacity-60 transition-colors"
              >
                <Check size={11} /> Submit
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded border border-blue-200 bg-white hover:bg-blue-50 transition-colors"
            >
              <Edit2 size={11} /> Edit
            </button>
          )}
        </div>
      </div>

      {/* Sections */}
      <div>
        {SECTION_ORDER.map((sectionKey) => {
          const raw = data[sectionKey]

          // ── Array of objects (facts, inferences) ──
          if (Array.isArray(raw)) {
            const items = raw as unknown as Record<string, unknown>[]
            if (items.length === 0) return null
            return (
              <Section key={sectionKey} label={SECTION_LABELS[sectionKey]} defaultOpen={sectionKey === "extracted_facts"}>
                {items.map((item, i) => <FactRow key={i} item={item} />)}
              </Section>
            )
          }

          // ── Object section ──
          if (raw && typeof raw === "object") {
            const section = raw as Record<string, unknown>
            const hasAny = isEditing || sectionHasContent(section)
            if (!hasAny) return null
            return (
              <Section key={sectionKey} label={SECTION_LABELS[sectionKey]}>
                {Object.entries(section).map(([field, value]) => (
                  <FieldRow
                    key={field}
                    label={field}
                    value={value}
                    editMode={isEditing}
                    onChange={(v) => updateField(sectionKey, field, v)}
                  />
                ))}
              </Section>
            )
          }

          return null
        })}
      </div>
    </div>
  )
}
