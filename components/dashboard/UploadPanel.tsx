"use client"

import { useRef, useState } from "react"
import {
  UploadCloud,
  X,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react"
import toast from "react-hot-toast"
import { useChatStore } from "@/store/chat-store"

const MAX_SIZE_MB = 20
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

interface Props {
  chatId: string
}

type UploadStatus = "idle" | "uploading" | "success" | "error"

interface FileEntry {
  id: string
  file: File
  status: UploadStatus
  fileUrl: string | null
}

export function UploadPanel({ chatId }: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { setIsUploading } = useChatStore()

  function updateEntry(id: string, patch: Partial<FileEntry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
    if (!selected.length) return

    const oversized = selected.filter((f) => f.size > MAX_SIZE_BYTES)
    if (oversized.length) {
      toast.error(`${oversized.map((f) => f.name).join(", ")} exceed the ${MAX_SIZE_MB}MB limit.`)
    }

    const valid = selected.filter((f) => f.size <= MAX_SIZE_BYTES)
    const newEntries: FileEntry[] = valid.map((f) => ({
      id: `${Date.now()}-${Math.random()}`,
      file: f,
      status: "idle",
      fileUrl: null,
    }))
    setEntries((prev) => [...prev, ...newEntries])

    // reset input so same files can be re-added after removal
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  async function uploadEntry(entry: FileEntry) {
    updateEntry(entry.id, { status: "uploading" })
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", entry.file)

      const res = await fetch(`/api/chats/${chatId}/upload`, {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        updateEntry(entry.id, { status: "error" })
        toast.error(`Failed to upload ${entry.file.name}`, { id: `upload-err-${entry.id}` })
        return
      }

      const data = await res.json()
      updateEntry(entry.id, { status: "success", fileUrl: data.fileUrl ?? null })
      toast.success(`${entry.file.name} uploaded!`)
    } catch (err) {
      console.error("[UploadPanel]", err)
      updateEntry(entry.id, { status: "error" })
      toast.error(`Failed to upload ${entry.file.name}`, { id: `upload-err-${entry.id}` })
    } finally {
      setIsUploading(false)
    }
  }

  async function uploadAll() {
    const pending = entries.filter((e) => e.status === "idle" || e.status === "error")
    for (const entry of pending) {
      await uploadEntry(entry)
    }
  }

  const hasPending = entries.some((e) => e.status === "idle" || e.status === "error")

  return (
    <div className="px-5 py-4">
      <p className="text-xs font-medium text-gray-600 mb-3">
        Upload files (image, video, audio, PDF, doc) — max {MAX_SIZE_MB}MB each
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
        multiple
        onChange={handleFileChange}
        className="hidden"
        id="upload-input"
      />

      {/* Drop zone */}
      <label
        htmlFor="upload-input"
        className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 py-4 cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-colors mb-3"
      >
        <UploadCloud size={18} className="text-gray-400" />
        <span className="text-sm text-gray-500">Click to add files</span>
      </label>

      {/* File list */}
      {entries.length > 0 && (
        <div className="space-y-2 mb-3">
          {entries.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-gray-200 p-3 flex items-center gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-md bg-blue-50 flex items-center justify-center">
                <FileText size={14} className="text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{entry.file.name}</p>
                <p className="text-[10px] text-gray-400">{(entry.file.size / 1024).toFixed(1)} KB</p>
              </div>
              {/* Status */}
              {entry.status === "idle" && (
                <button onClick={() => removeEntry(entry.id)} className="text-gray-400 hover:text-gray-600">
                  <X size={14} />
                </button>
              )}
              {entry.status === "uploading" && <Loader2 size={15} className="animate-spin text-blue-500 flex-shrink-0" />}
              {entry.status === "success" && (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={15} className="text-green-500 flex-shrink-0" />
                  {entry.fileUrl && (
                    <a href={entry.fileUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-green-600 underline">
                      View
                    </a>
                  )}
                </div>
              )}
              {entry.status === "error" && (
                <div className="flex items-center gap-1.5">
                  <AlertCircle size={15} className="text-red-500 flex-shrink-0" />
                  <button onClick={() => uploadEntry(entry)} className="text-[10px] text-red-500 underline">Retry</button>
                  <button onClick={() => removeEntry(entry.id)} className="text-gray-400 hover:text-gray-600">
                    <X size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {hasPending && (
        <button
          onClick={uploadAll}
          disabled={entries.some((e) => e.status === "uploading")}
          className="w-full flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          {entries.some((e) => e.status === "uploading") ? (
            <><Loader2 size={13} className="animate-spin" /> Uploading…</>
          ) : (
            <><UploadCloud size={13} /> Upload {entries.filter((e) => e.status === "idle" || e.status === "error").length} file(s)</>
          )}
        </button>
      )}
    </div>
  )
}
