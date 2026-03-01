"use client"

import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { persist, createJSONStorage } from "zustand/middleware"
import type {
  StructuredRequirement,
  ChatSession,
  Message,
  TravelAgent,
} from "@/lib/types"

// ─── CHAT STORE ───────────────────────────────────────────────────────────────

interface ChatStore {
  // active session
  activeChatId: string | null
  structuredRequirement: StructuredRequirement | null
  metadata: Record<string, unknown> | null
  messages: Message[]
  isLoadingChat: boolean
  isSendingMessage: boolean
  isUploading: boolean
  uploadProgress: number
  editingRequirement: StructuredRequirement | null

  // sidebar state
  chatHistory: ChatSession[]
  isSidebarOpen: boolean

  // per-chat message cache (persisted to localStorage)
  messageCache: Record<string, Message[]>

  // actions
  setActiveChatId: (id: string | null) => void
  setStructuredRequirement: (data: StructuredRequirement | null) => void
  setMetadata: (data: Record<string, unknown> | null) => void
  setMessages: (msgs: Message[]) => void
  addMessage: (msg: Message) => void
  setIsLoadingChat: (v: boolean) => void
  setIsSendingMessage: (v: boolean) => void
  setIsUploading: (v: boolean) => void
  setUploadProgress: (v: number) => void
  setEditingRequirement: (data: StructuredRequirement | null) => void
  updateEditingField: (path: string[], value: unknown) => void
  setChatHistory: (sessions: ChatSession[]) => void
  addChatSession: (session: ChatSession) => void
  toggleSidebar: () => void
  resetChat: () => void
  /** Save current messages into the persistent cache for a chat */
  cacheMessages: (chatId: string, msgs: Message[]) => void
  /** Retrieve cached messages for a chat */
  getCachedMessages: (chatId: string) => Message[]
}

export const useChatStore = create<ChatStore>()(
  persist(
    immer((set, get) => ({
      activeChatId: null,
      structuredRequirement: null,
      metadata: null,
      messages: [],
      isLoadingChat: false,
      isSendingMessage: false,
      isUploading: false,
      uploadProgress: 0,
      editingRequirement: null,
      chatHistory: [],
      isSidebarOpen: true,
      messageCache: {},

      setActiveChatId: (id) => set((s) => { s.activeChatId = id }),
      setStructuredRequirement: (data) => set((s) => {
        s.structuredRequirement = data
        s.editingRequirement = data ? JSON.parse(JSON.stringify(data)) : null
      }),
      setMetadata: (data) => set((s) => { s.metadata = data }),
      setMessages: (msgs) => set((s) => { s.messages = msgs }),
      addMessage: (msg) => set((s) => {
        s.messages.push(msg)
        // Auto-cache whenever a message is added
        if (s.activeChatId) {
          s.messageCache[s.activeChatId] = [...s.messages]
        }
      }),
      setIsLoadingChat: (v) => set((s) => { s.isLoadingChat = v }),
      setIsSendingMessage: (v) => set((s) => { s.isSendingMessage = v }),
      setIsUploading: (v) => set((s) => { s.isUploading = v }),
      setUploadProgress: (v) => set((s) => { s.uploadProgress = v }),
      setEditingRequirement: (data) => set((s) => { s.editingRequirement = data }),
      updateEditingField: (path, value) =>
        set((s) => {
          if (!s.editingRequirement) return
          let target: Record<string, unknown> = s.editingRequirement as Record<string, unknown>
          for (let i = 0; i < path.length - 1; i++) {
            target = (target[path[i]] ?? {}) as Record<string, unknown>
          }
          target[path[path.length - 1]] = value
        }),
      setChatHistory: (sessions) => set((s) => { s.chatHistory = sessions }),
      addChatSession: (session) =>
        set((s) => { s.chatHistory.unshift(session) }),
      toggleSidebar: () => set((s) => { s.isSidebarOpen = !s.isSidebarOpen }),
      resetChat: () =>
        set((s) => {
          s.activeChatId = null
          s.structuredRequirement = null
          s.metadata = null
          s.messages = []
          s.editingRequirement = null
        }),
      cacheMessages: (chatId, msgs) =>
        set((s) => { s.messageCache[chatId] = msgs }),
      getCachedMessages: (chatId) => get().messageCache[chatId] ?? [],
    })),
    {
      name: "voyage-chat-store",
      storage: createJSONStorage(() => localStorage),
      // Only persist these fields — transient UI state is excluded
      partialize: (s) => ({
        activeChatId: s.activeChatId,
        chatHistory: s.chatHistory,
        messageCache: s.messageCache,
        isSidebarOpen: s.isSidebarOpen,
      }),
    }
  )
)

// ─── AGENT STORE ──────────────────────────────────────────────────────────────

interface AgentStore {
  agent: TravelAgent | null
  setAgent: (agent: TravelAgent | null) => void
}

export const useAgentStore = create<AgentStore>()((set) => ({
  agent: null,
  setAgent: (agent) => set({ agent }),
}))
