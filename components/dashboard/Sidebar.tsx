"use client"

import { useState, useEffect } from "react"
import {
  Plus,
  Search,
  MessageSquare,
  PanelLeftClose,
  PanelLeft,
  LogOut,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useUser } from "@stackframe/stack"
import { useChatStore, useAgentStore } from "@/store/chat-store"
import { cn } from "@/lib/utils"
import { NewChatModal } from "./NewChatModal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { ChatSession } from "@/lib/types"

export function Sidebar() {
  const router = useRouter()
  const user = useUser()
  const agent = useAgentStore((s) => s.agent)
  const {
    activeChatId,
    chatHistory,
    setChatHistory,
    setActiveChatId,
    resetChat,
    setMessages,
    setStructuredRequirement,
    setIsLoadingChat,
    toggleSidebar,
    isSidebarOpen,
    getCachedMessages,
    cacheMessages,
  } = useChatStore()

  const [search, setSearch] = useState("")
  const [showNewChat, setShowNewChat] = useState(false)

  // Load chat history on mount
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/chats")
        if (!res.ok) return
        const data = await res.json()
        setChatHistory(data.chats ?? data ?? [])
      } catch (err) {
        console.error("[Sidebar] load chats:", err)
      }
    }
    load()
  }, [setChatHistory])

  const filtered = chatHistory.filter(
    (c) =>
      c.phone_number?.toLowerCase().includes(search.toLowerCase()) ||
      c.last_message?.toLowerCase().includes(search.toLowerCase())
  )

  async function openChat(session: ChatSession) {
    if (session.chat_id === activeChatId) return
    resetChat()
    setActiveChatId(session.chat_id)

    // 1. Instantly show cached messages from localStorage (no loading flash)
    const cached = getCachedMessages(session.chat_id)
    if (cached.length > 0) setMessages(cached)

    // 2. Fetch real messages + structured_requirement from DB (source of truth)
    setIsLoadingChat(cached.length === 0)
    try {
      const res = await fetch(`/api/chats/${session.chat_id}/messages`)
      if (res.ok) {
        const data = await res.json()

        // Prefer DB messages if they exist
        if (data.messages && data.messages.length > 0) {
          setMessages(data.messages)
          cacheMessages(session.chat_id, data.messages)
        } else if (cached.length === 0 && data.structured_requirement) {
          // No messages stored anywhere — synthesise a requirements card
          const cardMsg = {
            id: `struct-restore-${Date.now()}`,
            chat_id: session.chat_id,
            role: "assistant" as const,
            content: "",
            structuredData: data.structured_requirement,
            created_at: new Date().toISOString(),
          }
          setMessages([cardMsg])
          cacheMessages(session.chat_id, [cardMsg])
        }

        if (data.structured_requirement) {
          setStructuredRequirement(data.structured_requirement)
        }
      }
    } catch (err) {
      console.error("[Sidebar] load messages:", err)
    } finally {
      setIsLoadingChat(false)
    }
  }

  const displayName = agent?.name ?? user?.displayName ?? "Agent"
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <TooltipProvider delayDuration={300}>
      <>
        <div className="flex h-full flex-col bg-[#2C1A0E] text-[#F5EFE6] border-r border-[#1A0E05]">

          {/* ── header ── */}
          <div className="flex items-center justify-between px-4 h-14 border-b border-[#1A0E05] flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-[#F5EFE6] flex items-center justify-center">
                <MessageSquare size={12} className="text-[#3D2814]" />
              </div>
              <span className="text-sm font-semibold tracking-tight text-[#F5EFE6]">Voyage</span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleSidebar}
                  className="h-7 w-7 text-[#B09880] hover:text-[#F5EFE6] hover:bg-[#3D2814]"
                >
                  <PanelLeftClose size={15} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Collapse sidebar</TooltipContent>
            </Tooltip>
          </div>

          {/* ── agent info ── */}
          <div className="px-3 py-3 border-b border-[#1A0E05] flex-shrink-0">
            <div className="flex items-center gap-2.5 px-1">
              <Avatar className="h-7 w-7 flex-shrink-0">
                <AvatarFallback className="bg-[#5C4033] text-[#F5EFE6] text-[10px] font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-xs font-medium truncate leading-tight text-[#F5EFE6]">{displayName}</p>
                <p className="text-[10px] text-[#8B6347] leading-tight">Travel Agent</p>
              </div>
            </div>
          </div>

          {/* ── new chat ── */}
          <div className="px-3 pt-3 pb-2 flex-shrink-0">
            <Button
              onClick={() => setShowNewChat(true)}
              className="w-full h-8 text-xs font-semibold bg-[#F5EFE6] text-[#3D2814] hover:bg-white gap-1.5 rounded-none tracking-wide"
            >
              <Plus size={13} />
              New Chat
            </Button>
          </div>

          {/* ── search ── */}
          <div className="px-3 pb-2 flex-shrink-0">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8B6347]" />
              <Input
                type="text"
                placeholder="Search chats…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 text-xs bg-[#1A0E05] border-[#3D2814] text-[#F5EFE6] placeholder:text-[#5C4033] focus-visible:ring-[#5C4033]"
              />
            </div>
          </div>

          <Separator className="bg-[#1A0E05] flex-shrink-0" />

          {/* ── chat history ── */}
          <ScrollArea className="flex-1 px-2 py-2">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-[#5C4033]">
                <MessageSquare size={20} strokeWidth={1.2} />
                <p className="text-xs text-center">No chats yet.<br />Create one to get started.</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {filtered.map((session) => (
                  <ChatHistoryItem
                    key={session.chat_id}
                    session={session}
                    isActive={session.chat_id === activeChatId}
                    onClick={() => openChat(session)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>

          {/* ── sign out ── */}
          <div className="px-3 py-3 border-t border-[#1A0E05] flex-shrink-0">
            <a
              href="/handler/sign-out"
              className="flex items-center gap-2 text-[11px] text-[#8B6347] hover:text-[#F5EFE6] transition-colors px-1"
            >
              <LogOut size={12} />
              Sign out
            </a>
          </div>
        </div>

        {/* Toggle button when closed */}
        {!isSidebarOpen && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                className="fixed left-3 top-3 z-50 h-8 w-8 bg-[#2C1A0E] border border-[#3D2814] text-[#B09880] hover:bg-[#3D2814] shadow-md"
              >
                <PanelLeft size={15} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Open sidebar</TooltipContent>
          </Tooltip>
        )}

        {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} onCreated={() => { setShowNewChat(false); router.push("/chats") }} />}
      </>
    </TooltipProvider>
  )
}

function ChatHistoryItem({
  session,
  isActive,
  onClick,
}: {
  session: ChatSession
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors group",
        isActive
          ? "bg-[#3D2814] text-[#F5EFE6]"
          : "text-[#B09880] hover:bg-[#3D2814]/60 hover:text-[#F5EFE6]"
      )}
    >
      <div className={cn(
        "mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5",
        isActive ? "bg-[#F5EFE6]" : "bg-[#5C4033] group-hover:bg-[#8B6347]"
      )} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">
          {session.customer_name || session.phone_number || "Unknown customer"}
        </p>
        <p className="text-[10px] text-[#5C4033] mt-0.5 truncate">
          {session.phone_number}
        </p>
        {session.destinations && session.destinations.length > 0 && (
          <p className="text-[10px] text-[#8B6347] truncate mt-0.5 group-hover:text-[#B09880]">
            ✈ {session.destinations.join(" → ")}
          </p>
        )}
      </div>
    </button>
  )
}
