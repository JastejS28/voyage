"use client"

import { useState } from "react"
import { CheckSquare, Loader2, RotateCcw, ChevronDown, ChevronRight } from "lucide-react"
import toast from "react-hot-toast"
import { useChatStore } from "@/store/chat-store"
import { cleanObject, formatKey, isPlainObject } from "@/lib/utils"
import { EditableField } from "./EditableField"

export function StructuredPanel() {
  const {
    activeChatId,
    structuredRequirement,
    editingRequirement,
    isSendingMessage,
    setStructuredRequirement,
    setMetadata,
    setIsSendingMessage,
    setEditingRequirement,
  } = useChatStore()

  const [isUpdating, setIsUpdating] = useState(false)

  // Nothing to show
  if (!activeChatId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <p className="text-sm text-gray-400">Select a chat to view structured requirements.</p>
      </div>
    )
  }

  if (!structuredRequirement) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <p className="text-sm text-gray-400">
          Requirements will appear here after the first message.
        </p>
      </div>
    )
  }

  const cleaned = cleanObject(structuredRequirement) as Record<string, unknown> | undefined
  if (!cleaned) return null

  async function handleUpdate() {
    if (!activeChatId || !editingRequirement) return
    setIsUpdating(true)

    try {
      const res = await fetch(`/api/chats/${activeChatId}/flow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "", // re-trigger with edits
          edited_structured_requirement: editingRequirement,
        }),
      })

      if (!res.ok) {
        toast.error("Update failed. Please retry.")
        return
      }

      const data = await res.json()
      if (data.structured_requirement) {
        setStructuredRequirement(data.structured_requirement)
      }
      if (data.metadata) {
        setMetadata(data.metadata)
      }
      toast.success("Requirements updated!")
    } catch (err) {
      console.error("[StructuredPanel] update:", err)
      toast.error("Network error. Please retry.")
    } finally {
      setIsUpdating(false)
    }
  }

  function handleReset() {
    setEditingRequirement(structuredRequirement)
    toast("Changes reset.", { icon: "↩️" })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">Requirements</h3>
        <div className="flex gap-2">
          <button
            onClick={handleReset}
            title="Reset edits"
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <RotateCcw size={13} />
          </button>
          <button
            onClick={handleUpdate}
            disabled={isUpdating || isSendingMessage}
            title="Confirm edits"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {isUpdating ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <CheckSquare size={11} />
            )}
            Update
          </button>
        </div>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {Object.entries(cleaned).map(([sectionKey, sectionValue]) => (
          <RequirementSection
            key={sectionKey}
            sectionKey={sectionKey}
            sectionValue={sectionValue}
            path={[sectionKey]}
          />
        ))}
      </div>
    </div>
  )
}

function RequirementSection({
  sectionKey,
  sectionValue,
  path,
}: {
  sectionKey: string
  sectionValue: unknown
  path: string[]
}) {
  const [open, setOpen] = useState(true)

  // ── Plain object section (e.g. trip_overview, travelers) ──────────────────
  if (isPlainObject(sectionValue)) {
    const entries = Object.entries(sectionValue as Record<string, unknown>)
    if (entries.length === 0) return null

    return (
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors"
        >
          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            {formatKey(sectionKey)}
          </span>
          {open ? (
            <ChevronDown size={13} className="text-gray-400" />
          ) : (
            <ChevronRight size={13} className="text-gray-400" />
          )}
        </button>

        {open && (
          <div className="divide-y divide-gray-100">
            {entries.map(([key, value]) => (
              <EditableField
                key={key}
                fieldKey={key}
                value={value}
                path={[...path, key]}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Array of objects (e.g. extracted_facts) ───────────────────────────────
  if (Array.isArray(sectionValue)) {
    if (sectionValue.length === 0) return null
    const hasObjects = sectionValue.some((item) => isPlainObject(item))

    return (
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors"
        >
          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            {formatKey(sectionKey)}
          </span>
          {open ? (
            <ChevronDown size={13} className="text-gray-400" />
          ) : (
            <ChevronRight size={13} className="text-gray-400" />
          )}
        </button>

        {open && (
          <div className="divide-y divide-gray-100">
            {hasObjects
              ? (sectionValue as Record<string, unknown>[]).map((item, i) => (
                  <ObjectFactRow key={i} item={item} index={i} />
                ))
              : (
                <EditableField
                  fieldKey={sectionKey}
                  value={sectionValue}
                  path={path}
                />
              )}
          </div>
        )}
      </div>
    )
  }

  // ── Top-level scalar or notes ─────────────────────────────────────────────
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <EditableField
        fieldKey={sectionKey}
        value={sectionValue}
        path={path}
        standalone
      />
    </div>
  )
}

/** Renders a single object item from an array (e.g. one extracted_fact) */
function ObjectFactRow({
  item,
  index,
}: {
  item: Record<string, unknown>
  index: number
}) {
  return (
    <div className="px-3 py-2.5 space-y-1">
      <p className="text-[10px] text-gray-400 uppercase tracking-wide">#{index + 1}</p>
      {Object.entries(item).map(([k, v]) =>
        v !== null && v !== undefined ? (
          <div key={k} className="flex items-start gap-2">
            <span className="text-[10px] text-gray-400 uppercase tracking-wide min-w-[80px] pt-0.5">
              {formatKey(k)}
            </span>
            <span className="text-sm text-gray-800 break-words">{String(v)}</span>
          </div>
        ) : null
      )}
    </div>
  )
}
