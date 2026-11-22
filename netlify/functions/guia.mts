import type { Config } from "@netlify/functions"
import { GUIDE_KEY, links, guide, isToken } from "../lib/guide.ts"

// Serves the private PDF, only with a valid and unexpired link created by /api/entrega.
// The PDF never has a public URL: it lives in a private blob store.
const deny = (status: number, msg: string) =>
  new Response(msg, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } })

export default async (req: Request) => {
  const k = new URL(req.url).searchParams.get("k")
  if (!isToken(k)) return deny(404, "Enlace no válido.")

  const link: any = await links().get(k, { type: "json" }).catch(() => null)
  if (!link) return deny(404, "Enlace no válido.")
  if (Date.now() > Number(link.expires)) {
    await links().delete(k).catch(() => {})
    return deny(410, "Este enlace ha caducado. Vuelve a la página de confirmación para obtener uno nuevo.")
  }

  const pdf = await guide().get(GUIDE_KEY, { type: "arrayBuffer" }).catch(() => null)
  if (!pdf) {
    console.error("Guide PDF missing from the private store")
    return deny(503, "La guía no está disponible ahora mismo. Escríbenos y te la enviamos.")
  }

  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="Mentalidad-de-Campeon.pdf"',
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  })
}

export const config: Config = { path: "/api/guia", method: ["GET"] }
