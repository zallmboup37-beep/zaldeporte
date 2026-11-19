import { getStore } from "@netlify/blobs"
import type { Config, Context } from "@netlify/functions"

// Records one visitor event as an append-only blob key (no read-modify-write).
// Key format: e/YYYY-MM-DD/<ts>_<type>_<country>_<source>_<device>_<visitorId>_<rand>
const TYPES = new Set(["v", "c", "h"])
const SOURCES = new Set(["tiktok", "youtube", "instagram", "facebook", "google", "whatsapp", "direct", "other"])
const clean = (s: unknown, max = 24) => String(s ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, max)

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })
  const ua = req.headers.get("user-agent") ?? ""
  if (/bot|crawl|spider|preview|headless|lighthouse/i.test(ua)) return new Response(null, { status: 204 })

  let body: Record<string, unknown> = {}
  try { body = JSON.parse(await req.text()) } catch { return new Response("Bad request", { status: 400 }) }

  const type = clean(body.t, 1)
  if (!TYPES.has(type)) return new Response("Bad type", { status: 400 })
  const src = SOURCES.has(clean(body.s)) ? clean(body.s) : "other"
  const dev = clean(body.d, 1) === "m" ? "m" : "d"
  const vid = clean(body.vid, 16) || "anon"
  const country = clean(context.geo?.country?.code, 2).toUpperCase() || "XX"

  const now = Date.now()
  const day = new Date(now).toISOString().slice(0, 10)
  const rand = Math.random().toString(36).slice(2, 7)
  const key = `e/${day}/${now}_${type}_${country}_${src}_${dev}_${vid}_${rand}`

  await getStore("analytics").set(key, "1")
  return new Response(null, { status: 204 })
}

export const config: Config = { path: "/api/track", method: ["POST"] }
