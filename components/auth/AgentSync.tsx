"use client"

import { useEffect } from "react"
import { useUser } from "@stackframe/stack"
import { useAgentStore } from "@/store/chat-store"
import type { TravelAgent } from "@/lib/types"

/**
 * Runs once on mount after login to upsert the travel agent
 * record in NeonDB and store it in Zustand.
 */
export function AgentSync() {
  const user = useUser()
  const setAgent = useAgentStore((s) => s.setAgent)

  useEffect(() => {
    if (!user) return

    async function sync() {
      try {
        const res = await fetch("/api/agent/sync", { method: "POST" })
        if (!res.ok) return
        const data = await res.json() as { agent: TravelAgent }
        setAgent(data.agent)
      } catch (err) {
        console.error("[AgentSync]", err)
      }
    }

    sync()
  }, [user, setAgent])

  return null
}
