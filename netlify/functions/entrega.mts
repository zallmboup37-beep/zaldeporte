import type { Config } from "@netlify/functions"
import { PRODUCT_ID, GUIDE_KEY, ORDER_TTL_MS, LINK_TTL_MS, chariowBase, salesKey, orders, links, guide, isToken, randomToken } from "../lib/guide.ts"

// Called by /gracias/?t=<token>. Asks Chariow whether the linked sale is really paid
// and for the right product; only then hands out a short-lived download link.
//   -> { status: "ready", url }  paid and valid
//   -> { status: "pending" }     payment not confirmed yet (the page keeps polling)
//   -> { status: "failed" }      payment failed / abandoned / refunded
//   -> { status: "unknown" }     unknown or expired token
const json = (b: unknown, status = 200) =>
  Response.json(b, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } })

export default async (req: Request) => {
  const t = new URL(req.url).searchParams.get("t")
  if (!isToken(t)) return json({ status: "unknown" }, 404)

  const key = salesKey()
  if (!key) return json({ status: "error" }, 503)

  const order: any = await orders().get(t, { type: "json" }).catch(() => null)
  if (!order?.sale_id || Date.now() - Number(order.created) > ORDER_TTL_MS) return json({ status: "unknown" }, 404)

  let sale: any
  try {
    const res = await fetch(`${chariowBase()}/v1/sales/${encodeURIComponent(order.sale_id)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    })
    if (!res.ok) {
      console.error("Chariow get sale error", res.status)
      return json({ status: "error" }, 502)
    }
    sale = (await res.json())?.data
  } catch (e) {
    console.error("Chariow get sale failed", String(e))
    return json({ status: "error" }, 502)
  }

  // Never trust the token alone: the sale must belong to THIS product and not be revoked.
  if (sale?.id !== order.sale_id || sale?.product?.id !== PRODUCT_ID || sale?.is_access_revoked === true) {
    return json({ status: "unknown" }, 404)
  }

  const st = String(sale.status)
  if (st === "completed" || st === "settled") {
    // Never promise a download we cannot serve (e.g. PDF not uploaded yet): the page then falls back
    // to "you will receive it by email" and Chariow's own delivery still works.
    if (!(await guide().getMetadata(GUIDE_KEY).catch(() => null))) {
      console.error("Paid sale but the guide PDF is not in the private store yet")
      return json({ status: "error" }, 503)
    }
    const k = randomToken()
    await links().setJSON(k, { expires: Date.now() + LINK_TTL_MS, sale_id: order.sale_id })
    return json({ status: "ready", url: `/api/guia?k=${k}` })
  }
  if (st === "failed" || st === "abandoned") return json({ status: "failed" })
  return json({ status: "pending" })
}

export const config: Config = { path: "/api/entrega", method: ["GET"] }
