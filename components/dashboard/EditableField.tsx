"use client"

import { useState } from "react"
import { Pencil, Check, X } from "lucide-react"
import { useChatStore } from "@/store/chat-store"
import { formatKey, cn } from "@/lib/utils"

interface Props {
  fieldKey: string
  value: unknown
  path: string[]
  standalone?: boolean
}

export function EditableField({ fieldKey, value, path, standalone = false }: Props) {
  const updateEditingField = useChatStore((s) => s.updateEditingField)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")

  // Arrays — render as pill list, no inline edit for now
  if (Array.isArray(value)) {
    return (
      <div className={cn("px-3 py-2.5", standalone && "bg-gray-50")}>
        <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">
          {formatKey(fieldKey)}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(value as unknown[]).map((item, i) => (
            <span
              key={i}
              className="inline-block rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-700 border border-blue-100"
            >
              {String(item)}
            </span>
          ))}
        </div>
      </div>
    )
  }

  function startEdit() {
    setDraft(value !== null && value !== undefined ? String(value) : "")
    setEditing(true)
  }

  function confirmEdit() {
    updateEditingField(path, draft)
    setEditing(false)
  }

  function cancelEdit() {
    setEditing(false)
  }

  return (
    <div
      className={cn(
        "group flex items-start gap-2 px-3 py-2.5",
        standalone && "bg-gray-50"
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">
          {formatKey(fieldKey)}
        </p>

        {editing ? (
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmEdit()
              if (e.key === "Escape") cancelEdit()
            }}
            className="w-full rounded border border-blue-300 bg-white px-2 py-1 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-200"
          />
        ) : (
          <p className="text-sm text-gray-800 break-words">
            {value !== null && value !== undefined && value !== ""
              ? String(value)
              : <span className="text-gray-400 italic">—</span>}
          </p>
        )}
      </div>

      {/* Edit controls */}
      <div className="flex-shrink-0 mt-0.5">
        {editing ? (
          <div className="flex gap-1">
            <button
              onClick={confirmEdit}
              className="p-1 rounded text-green-600 hover:bg-green-50 transition-colors"
              title="Confirm"
            >
              <Check size={13} />
            </button>
            <button
              onClick={cancelEdit}
              className="p-1 rounded text-gray-400 hover:bg-gray-100 transition-colors"
              title="Cancel"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <button
            onClick={startEdit}
            className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
            title="Edit"
          >
            <Pencil size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
