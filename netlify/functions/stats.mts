import { getStore } from "@netlify/blobs"
import type { Config, Context } from "@netlify/functions"

// Aggregates visitor events for the private admin dashboard.
// Protected by the ADMIN_PASSWORD environment variable (sent in the x-admin-key header).
type Ev = { ts: number; t: string; c: string; s: string; d: string; v: string }

const parse = (key: string): Ev | null => {
  const name = key.split("/")[2]
  if (!name) return null
  const [ts, t, c, s, d, v] = name.split("_")
  const n = Number(ts)
  return Number.isFinite(n) ? { ts: n, t, c, s, d, v } : null
}

const tally = (items: string[]) => {
  const m = new Map<string, number>()
  for (const k of items) m.set(k, (m.get(k) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }))
}

export default async (req: Request, context: Context) => {
  const expected = Netlify.env.get("ADMIN_PASSWORD")
  if (!expected) return Response.json({ error: "not_configured" }, { status: 503 })
  if (req.headers.get("x-admin-key") !== expected) return Response.json({ error: "unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 1, 1), 30)
  const now = Date.now()
  const store = getStore({ name: "analytics", consistency: "strong" })

  const evs: Ev[] = []
  for (let i = 0; i < days; i++) {
    const day = new Date(now - i * 864e5).toISOString().slice(0, 10)
    const { blobs } = await store.list({ prefix: `e/${day}/` })
    for (const b of blobs) { const e = parse(b.key); if (e) evs.push(e) }
  }

  const live = new Set(evs.filter(e => now - e.ts < 90_000).map(e => e.v)).size
  const views = evs.filter(e => e.t === "v")
  const clicks = evs.filter(e => e.t === "c")
  const visitors = new Set(views.map(e => e.v))
  const clickers = new Set(clicks.map(e => e.v))

  // Time series: hourly for "today", daily otherwise.
  const series: { label: string; views: number; clicks: number }[] = []
  if (days === 1) {
    for (let h = 0; h < 24; h++) series.push({ label: `${h}h`, views: 0, clicks: 0 })
    const start = new Date(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z").getTime()
    for (const e of [...views, ...clicks]) {
      if (e.ts < start) continue
      const h = new Date(e.ts).getUTCHours()
      e.t === "v" ? series[h].views++ : series[h].clicks++
    }
  } else {
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * 864e5).toISOString().slice(0, 10)
      series.push({ label: d.slice(8, 10) + "/" + d.slice(5, 7), views: 0, clicks: 0 })
    }
    for (const e of [...views, ...clicks]) {
      const d = new Date(e.ts).toISOString().slice(0, 10)
      const idx = series.findIndex(s => s.label === d.slice(8, 10) + "/" + d.slice(5, 7))
      if (idx >= 0) e.t === "v" ? series[idx].views++ : series[idx].clicks++
    }
  }

  const recent = [...views, ...clicks].sort((a, b) => b.ts - a.ts).slice(0, 30)
    .map(e => ({ ts: e.ts, type: e.t, country: e.c, source: e.s, device: e.d }))

  return Response.json({
    days, generatedAt: now, live,
    views: views.length, visitors: visitors.size, clicks: clicks.length, clickers: clickers.size,
    countries: tally(views.map(e => e.c)).slice(0, 12),
    sources: tally(views.map(e => e.s)),
    devices: tally(views.map(e => e.d)),
    series, recent,
  }, { headers: { "cache-control": "no-store" } })
}

export const config: Config = { path: "/api/stats", method: ["GET"] }
