"use client"

import { useEffect, useRef } from "react"
import { Sidebar } from "@/components/dashboard/Sidebar"
import { ChatWindow } from "@/components/dashboard/ChatWindow"
import { useChatStore } from "@/store/chat-store"
import { cn } from "@/lib/utils"

export default function ChatsPage() {
  const {
    isSidebarOpen,
    activeChatId,
    setStructuredRequirement,
    getCachedMessages,
    setMessages,
    cacheMessages,
  } = useChatStore()

  // On first mount, if localStorage had an activeChatId, restore messages.
  const didRestore = useRef(false)
  useEffect(() => {
    if (didRestore.current || !activeChatId) return
    didRestore.current = true

    const cached = getCachedMessages(activeChatId)
    if (cached.length > 0) setMessages(cached)

    fetch(`/api/chats/${activeChatId}/messages`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return
        if (data.messages && data.messages.length > 0) {
          setMessages(data.messages)
          cacheMessages(activeChatId, data.messages)
        } else if (cached.length === 0 && data.structured_requirement) {
          const cardMsg = {
            id: `struct-restore-mount-${Date.now()}`,
            chat_id: activeChatId,
            role: "assistant" as const,
            content: "",
            structuredData: data.structured_requirement,
            created_at: new Date().toISOString(),
          }
          setMessages([cardMsg])
          cacheMessages(activeChatId, [cardMsg])
        }
        if (data.structured_requirement) {
          setStructuredRequirement(data.structured_requirement)
        }
      })
      .catch(console.error)
  }, [activeChatId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F5EFE6]">
      {/* ── Sidebar ── */}
      <aside
        className={cn(
          "flex-shrink-0 h-full transition-all duration-200",
          isSidebarOpen ? "w-64" : "w-0 overflow-hidden"
        )}
      >
        <Sidebar />
      </aside>

      {/* ── Chat Window ── */}
      <main className="flex-1 flex flex-col h-full min-w-0 bg-white shadow-[-1px_0_0_0_#D4C5B0]">
        <ChatWindow />
      </main>
    </div>
  )
}
