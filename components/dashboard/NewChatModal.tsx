"use client"

import { useState } from "react"
import { Phone, User, Mail, Loader2, CheckCircle2, UserPlus, ArrowLeft } from "lucide-react"
import toast from "react-hot-toast"
import { useChatStore } from "@/store/chat-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import type { ChatSession, CreateChatResponse } from "@/lib/types"

interface Props {
  onClose: () => void
  /** Called after a chat is successfully created. If not provided, falls back to onClose. */
  onCreated?: () => void
}

type Step = "phone" | "new-user" | "creating"

export function NewChatModal({ onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>("phone")
  const [phone, setPhone] = useState("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [lookingUp, setLookingUp] = useState(false)
  const [existingUserName, setExistingUserName] = useState<string | null>(null)

  const { addChatSession, setActiveChatId, resetChat } = useChatStore()

  // ── Step 1: look up phone ──────────────────────────────────────────────────
  async function handleLookup() {
    const cleaned = phone.trim()
    if (!cleaned) { toast.error("Please enter a phone number"); return }

    setLookingUp(true)
    try {
      const res = await fetch(`/api/users/lookup?phone=${encodeURIComponent(cleaned)}`)
      const data = await res.json()

      if (data.found) {
        // User exists — go straight to creating the chat
        setExistingUserName(data.user?.name ?? null)
        await createChat(cleaned, null, null)
      } else {
        // User not found — ask for details
        setStep("new-user")
      }
    } catch {
      toast.error("Lookup failed — please try again")
    } finally {
      setLookingUp(false)
    }
  }

  // ── Step 2: create user + chat ─────────────────────────────────────────────
  async function handleCreateUserAndChat() {
    if (!name.trim()) { toast.error("Name is required"); return }
    await createChat(phone.trim(), name.trim(), email.trim() || null)
  }

  // ── Shared: POST /api/chats ────────────────────────────────────────────────
  async function createChat(
    phoneNumber: string,
    userName: string | null,
    userEmail: string | null
  ) {
    setStep("creating")
    try {
      const res = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone_number: phoneNumber,
          ...(userName && { name: userName }),
          ...(userEmail && { email: userEmail }),
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error ?? "Failed to create chat")
        setStep(userName ? "new-user" : "phone")
        return
      }

      const data: CreateChatResponse = await res.json()
      const newSession: ChatSession = {
        chat_id: data.chat_id,
        phone_number: phoneNumber,
        customer_name: userName ?? existingUserName ?? undefined,
        created_at: new Date().toISOString(),
      }

      resetChat()
      addChatSession(newSession)
      setActiveChatId(data.chat_id)
      toast.success("Chat created!")
      onCreated ? onCreated() : onClose()
    } catch {
      toast.error("Something went wrong")
      setStep(userName ? "new-user" : "phone")
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[400px] p-0 gap-0 overflow-hidden">

        {/* ── Step 1: phone lookup ── */}
        {(step === "phone" || step === "creating") && (
          <>
            <DialogHeader className="px-6 pt-6 pb-4 border-b">
              <DialogTitle className="text-base">New chat</DialogTitle>
              <DialogDescription className="text-xs">
                Enter the customer&apos;s phone number to look them up.
              </DialogDescription>
            </DialogHeader>

            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700">
                  Phone number <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    type="tel"
                    placeholder="+1 555 000 0000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                    autoFocus
                    disabled={step === "creating"}
                    className="pl-8 h-9 text-sm"
                  />
                </div>
              </div>

              <Button
                onClick={handleLookup}
                disabled={lookingUp || step === "creating"}
                className="w-full h-9 bg-blue-600 hover:bg-blue-700 text-white text-sm"
              >
                {lookingUp || step === "creating" ? (
                  <><Loader2 size={13} className="animate-spin" />{step === "creating" ? "Creating chat…" : "Looking up…"}</>
                ) : "Continue"}
              </Button>
            </div>
          </>
        )}

        {/* ── Step 2: new user form ── */}
        {step === "new-user" && (
          <>
            <DialogHeader className="px-6 pt-6 pb-4 border-b">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
                  <UserPlus size={13} className="text-blue-600" />
                </div>
                <DialogTitle className="text-base">New customer</DialogTitle>
              </div>
              <DialogDescription asChild>
                <div className="text-xs text-muted-foreground">
                  No account found for{" "}
                  <Badge variant="secondary" className="font-mono text-[10px] px-1.5 py-0">{phone}</Badge>.
                  Fill in their details below.
                </div>
              </DialogDescription>
            </DialogHeader>

            <div className="px-6 py-5 space-y-4">
              {/* Phone (read-only) */}
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <Phone size={12} className="text-slate-400" />
                <span className="text-sm text-slate-600 flex-1 font-mono">{phone}</span>
                <CheckCircle2 size={13} className="text-green-500" />
              </div>

              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700">
                  Full name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    type="text"
                    placeholder="e.g. John Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateUserAndChat()}
                    autoFocus
                    className="pl-8 h-9 text-sm"
                  />
                </div>
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700">
                  Email <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    type="email"
                    placeholder="john@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateUserAndChat()}
                    className="pl-8 h-9 text-sm"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={() => setStep("phone")}
                  className="flex-1 h-9 text-sm gap-1.5"
                >
                  <ArrowLeft size={13} /> Back
                </Button>
                <Button
                  onClick={handleCreateUserAndChat}
                  className="flex-1 h-9 bg-blue-600 hover:bg-blue-700 text-white text-sm"
                >
                  Create &amp; Start Chat
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}


