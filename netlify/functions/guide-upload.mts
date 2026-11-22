import type { Config } from "@netlify/functions"
import { GUIDE_KEY, guide } from "../lib/guide.ts"

// Admin-only: puts the PDF into the private store (so it never has to be committed to the public repo).
// Same protection as /api/stats: the ADMIN_PASSWORD env var, sent in the x-admin-key header.
const MAX_BYTES = 5 * 1024 * 1024 // Netlify synchronous functions accept request bodies up to ~6 MB
const json = (b: unknown, status = 200) => Response.json(b, { status, headers: { "Cache-Control": "no-store" } })

export default async (req: Request) => {
  const expected = Netlify.env.get("ADMIN_PASSWORD")
  if (!expected) return json({ error: "not_configured" }, 503)
  if (req.headers.get("x-admin-key") !== expected) return json({ error: "unauthorized" }, 401)

  if (req.method === "GET") {
    const meta = await guide().getMetadata(GUIDE_KEY).catch(() => null)
    return json({ present: !!meta, ...(meta?.metadata ?? {}) })
  }

  const buf = new Uint8Array(await req.arrayBuffer())
  if (buf.byteLength < 1024) return json({ error: "empty" }, 400)
  if (buf.byteLength > MAX_BYTES) return json({ error: "too_large" }, 413)
  // A real PDF starts with "%PDF-".
  if (String.fromCharCode(...buf.slice(0, 5)) !== "%PDF-") return json({ error: "not_a_pdf" }, 415)

  await guide().set(GUIDE_KEY, buf, { metadata: { bytes: buf.byteLength, uploaded: new Date().toISOString() } })
  return json({ ok: true, bytes: buf.byteLength })
}

export const config: Config = { path: "/api/guide-upload", method: ["GET", "POST"] }
