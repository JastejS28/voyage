"use client"

import { useRef, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Send,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  X,
  Map,
} from "lucide-react"
import toast from "react-hot-toast"
import { useChatStore } from "@/store/chat-store"
import { cn } from "@/lib/utils"
import { MessageBubble } from "./MessageBubble"
import { UploadPanel } from "./UploadPanel"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { Message, ChatFlowResponse, StructuredRequirement } from "@/lib/types"

export function ChatWindow() {
  const router = useRouter()
  const {
    activeChatId,
    messages,
    addMessage,
    isSendingMessage,
    setIsSendingMessage,
    isLoadingChat,
    setStructuredRequirement,
    setMetadata,
    structuredRequirement,
  } = useChatStore()

  const [input, setInput] = useState("")
  const [showUpload, setShowUpload] = useState(false)

  // Fire-and-forget: persist a message to own NeonDB
  function persistMessage(msg: Message) {
    if (!activeChatId) return
    fetch(`/api/chats/${activeChatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        structured_data: msg.structuredData ?? null,
        created_at: msg.created_at,
      }),
    }).catch((e) => console.error("[persistMessage]", e))
  }
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 160) + "px"
  }, [input])

  async function sendMessage() {
    if (!input.trim() || !activeChatId || isSendingMessage) return

    const text = input.trim()
    setInput("")

    // Optimistically add user message to UI
    const userMsg: Message = {
      id: `tmp-${Date.now()}`,
      chat_id: activeChatId,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    }
    addMessage(userMsg)
    persistMessage(userMsg)
    setIsSendingMessage(true)

    try {
      const res = await fetch(`/api/chats/${activeChatId}/flow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })

      if (!res.ok) {
        toast.error("Failed to send message", {
          id: "chat-flow-error",
          duration: 5000,
        })
        return
      }

      const data: ChatFlowResponse = await res.json()
      console.log("[chat-flow] raw response:", data)

      // structured_requirement lives at data.chat.structured_requirement
      const structReq: StructuredRequirement | null =
        data.chat?.structured_requirement ??
        data.structured_requirement ??
        null

      // Reply text: last non-empty "ai" message in data.chat.agent_response.messages
      const agentMessages = data.chat?.agent_response?.messages ?? []
      const lastAiContent = agentMessages
        .filter((m) => m.type === "ai" && typeof m.content === "string" && m.content.trim() !== "")
        .at(-1)?.content ?? null

      // Strip markdown code fences if the AI wrapped JSON in ```json ... ```
      const cleanReply = lastAiContent
        ? lastAiContent.replace(/^```[\w]*\n?/m, "").replace(/\n?```$/m, "").trim()
        : null

      // If cleanReply is JSON (the AI echoed back the structured req), prefer the built summary
      let isJsonReply = false
      if (cleanReply) {
        try { JSON.parse(cleanReply); isJsonReply = true } catch { /* not JSON */ }
      }

      const replyText =
        data.reply ?? data.response ?? data.message ??
        (!isJsonReply && cleanReply ? cleanReply : null) ??
        null

      const aiMsg: Message = {
        id: `ai-${Date.now()}`,
        chat_id: activeChatId,
        role: "assistant",
        content: replyText || buildAssistantMessage(structReq),
        created_at: new Date().toISOString(),
      }
      addMessage(aiMsg)
      persistMessage(aiMsg)

      if (structReq) setStructuredRequirement(structReq)
      if (data.metadata) setMetadata(data.metadata)

      // Add the requirements card as a second inline message
      if (structReq) {
        const cardMsg: Message = {
          id: `struct-${Date.now()}`,
          chat_id: activeChatId,
          role: "assistant",
          content: "",
          structuredData: structReq,
          created_at: new Date().toISOString(),
        }
        addMessage(cardMsg)
        persistMessage(cardMsg)
      }
    } catch (err) {
      console.error("[ChatWindow] sendMessage:", err)
      toast.error("Network error — please retry", {
        id: "chat-flow-error",
        duration: 5000,
      })
    } finally {
      setIsSendingMessage(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ── empty state ──────────────────────────────────────────────────────────────
  if (!activeChatId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center p-8 select-none bg-[#FDFAF6]">
        <div className="w-14 h-14 rounded-2xl bg-[#EDE4D6] flex items-center justify-center mb-4">
          <MessageSquarePlus size={26} strokeWidth={1.3} className="text-[#8B6347]" />
        </div>
        <p className="text-sm font-semibold text-[#3D2814]">No conversation open</p>
        <p className="text-xs text-[#8B6347] mt-1 max-w-[200px]">Select a chat from the sidebar or create a new one to get started.</p>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-1 flex-col h-full bg-white">

        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-[#D4C5B0] px-5 h-14 flex-shrink-0 bg-white">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-sm font-semibold text-[#3D2814] leading-tight">Conversation</p>
              <p className="text-[10px] text-[#8B6347] font-mono leading-tight">{activeChatId.slice(0, 8)}…</p>
            </div>
            <span className="text-[10px] bg-[#EDE4D6] text-[#5C4033] border border-[#D4C5B0] rounded-full px-2 py-0.5 font-semibold">Active</span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showUpload ? "default" : "outline"}
                size="sm"
                onClick={() => setShowUpload(!showUpload)}
                className={cn(
                  "h-8 gap-1.5 text-xs",
                  showUpload && "bg-[#3D2814] hover:bg-[#5C4033] text-[#F5EFE6] border-[#3D2814]"
                )}
              >
                {showUpload ? <X size={12} /> : <Paperclip size={12} />}
                {showUpload ? "Close" : "Attach"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Upload files</TooltipContent>
          </Tooltip>
        </div>

        {/* ── Upload Panel (collapsible) ── */}
        {showUpload && (
          <div className="border-b border-[#D4C5B0] bg-[#FDFAF6]">
            <UploadPanel chatId={activeChatId} />
          </div>
        )}

        {/* ── Messages ── */}
        <ScrollArea className="flex-1 px-5 py-5 bg-[#FDFAF6]">
          {isLoadingChat ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#8B6347]">
              <Loader2 size={22} className="animate-spin" />
              <p className="text-xs">Loading conversation…</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-[#8B6347] select-none">
              <MessageSquarePlus size={24} strokeWidth={1.2} />
              <p className="text-xs text-center">Send a message to begin<br />extracting travel requirements.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
            </div>
          )}
          <div ref={bottomRef} />
        </ScrollArea>

        {/* ── Input ── */}
        <div className="border-t border-[#D4C5B0] px-4 py-3 bg-white flex-shrink-0">
          <div className={cn(
            "flex items-end gap-2 rounded border bg-[#FDFAF6] px-4 py-3 transition-all",
            "focus-within:ring-2 focus-within:ring-[#8B6347]/40 focus-within:border-[#8B6347] focus-within:bg-white"
          )}>
            <Textarea
              ref={textareaRef}
              rows={1}
              placeholder="Describe what the customer needs…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSendingMessage}
              className="flex-1 resize-none bg-transparent border-0 shadow-none p-0 text-sm text-[#3D2814] placeholder:text-[#B09880] focus-visible:ring-0 leading-relaxed min-h-[24px] max-h-[120px] disabled:opacity-60"
            />
            <Button
              onClick={sendMessage}
              disabled={!input.trim() || isSendingMessage}
              size="icon"
              className="flex-shrink-0 h-8 w-8 rounded bg-[#3D2814] hover:bg-[#5C4033] text-[#F5EFE6] self-end"
            >
              {isSendingMessage ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
            </Button>
          </div>
          {/* ── Generate Itinerary shortcut ── */}
          {structuredRequirement && (
            <div className="mt-2">
              <button
                onClick={() => router.push("/itinerary?autoGenerate=true")}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-[#C9A84C]/50 bg-[#FDFAF6] hover:bg-[#EDE4D6] text-[#5C4033] hover:text-[#3D2814] text-xs font-semibold transition-all group"
              >
                <Map size={13} className="text-[#C9A84C] group-hover:scale-110 transition-transform" />
                Generate Itinerary
              </button>
            </div>
          )}
          <p className="text-[10px] text-[#B09880] mt-1.5 pl-1">
            <kbd className="px-1 py-0.5 rounded border border-[#D4C5B0] bg-white text-[#8B6347] font-mono">Enter</kbd> to send·
            <kbd className="px-1 py-0.5 rounded border border-[#D4C5B0] bg-white text-[#8B6347] font-mono ml-1">Shift+Enter</kbd> for newline
          </p>
        </div>
      </div>
    </TooltipProvider>
  )
}

/**
 * Converts the AI response into a human-readable assistant message.
 * Shows a brief confirmation — the structured data lives in the panel.
 */
function buildAssistantMessage(req: StructuredRequirement | null): string {
  if (!req) return "I've processed your message."

  const parts: string[] = []

  const overview = req.trip_overview
  if (overview?.summary) parts.push(`📋 ${overview.summary}`)
  if (overview?.trip_type) parts.push(`🗺️ Trip type: ${overview.trip_type}`)

  const route = req.route_plan
  if (route?.destinations && route.destinations.length > 0) {
    parts.push(`📍 Destinations: ${route.destinations.join(" → ")}`)
  }

  const dates = req.dates
  if (dates?.start_date) parts.push(`📅 From: ${dates.start_date}`)
  if (dates?.duration_nights) parts.push(`🌙 Nights: ${dates.duration_nights}`)

  const travelers = req.travelers
  if (travelers?.adults) {
    parts.push(`👥 Travelers: ${travelers.adults} adult(s)${travelers.children ? `, ${travelers.children} child(ren)` : ""}`)
  }

  if (parts.length === 0) return "Got it! Check the requirements panel for extracted details."

  parts.push("\nFull details are in the panel →")
  return parts.join("\n")
}
