"use client"

import { cn } from "@/lib/utils"
import { RequirementsCard } from "./RequirementsCard"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import type { Message } from "@/lib/types"

interface Props {
  message: Message
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user"

  // Structured requirement card — rendered inline in the chat
  if (message.structuredData) {
    return (
      <div className="flex w-full justify-start items-start gap-2">
        <Avatar className="h-6 w-6 flex-shrink-0 mt-0.5">
          <AvatarFallback className="bg-blue-100 text-blue-600 text-[9px] font-bold">AI</AvatarFallback>
        </Avatar>
        <RequirementsCard requirement={message.structuredData} />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex w-full items-end gap-2",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {/* Avatar — only for assistant */}
      {!isUser && (
        <Avatar className="h-6 w-6 flex-shrink-0">
          <AvatarFallback className="bg-blue-100 text-blue-600 text-[9px] font-bold">AI</AvatarFallback>
        </Avatar>
      )}

      <div
        className={cn(
          "max-w-[70%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap shadow-xs",
          isUser
            ? "bg-[#3D2814] text-[#F5EFE6] rounded-br-sm"
            : "bg-white text-[#3D2814] rounded-bl-sm border border-[#D4C5B0]"
        )}
      >
        {message.content}
      </div>
    </div>
  )
}
