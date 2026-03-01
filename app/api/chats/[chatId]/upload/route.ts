import { NextRequest, NextResponse } from "next/server"
import { stackServerApp } from "@/stack/server"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL!

type Params = { params: Promise<{ chatId: string }> }

// POST /api/chats/[chatId]/upload  — proxy multipart to backend S3 upload
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await stackServerApp.getUser({ or: "return-null" })
    if (!user) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }

    const { chatId } = await params
    const formData = await req.formData()

    // Forward multipart exactly as-is — do NOT set Content-Type manually
    const res = await fetch(`${BACKEND_URL}/upload-file/${chatId}`, {
      method: "POST",
      body: formData,
    })

    if (!res.ok) {
      const text = await res.text()
      console.error("[upload POST] backend error:", text)
      return NextResponse.json({ error: "Upload failed" }, { status: res.status })
    }

    const data = await res.json()
    console.log(`[upload] ✅ chat=${chatId} upload_id=${data.upload_id} fileUrl=${data.fileUrl} extraction_status=${data.extraction_status}`)
    return NextResponse.json(data)
  } catch (err) {
    console.error("[upload POST]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
