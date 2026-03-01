import { stackServerApp } from "@/stack/server"
import { redirect } from "next/navigation"
import { AgentSync } from "@/components/auth/AgentSync"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await stackServerApp.getUser({ or: "return-null" })

  if (!user) {
    redirect("/handler/sign-in?after=/dashboard")
  }

  return (
    <>
      {/* Syncs StackAuth user → NeonDB travel_agents on every load */}
      <AgentSync />
      {children}
    </>
  )
}
