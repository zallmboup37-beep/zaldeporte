import type { Config, Context } from "@netlify/functions"
import { PRODUCT_ID, chariowBase, orders, randomToken } from "../lib/guide.ts"

// Creates a Chariow checkout from the landing-page form and returns the hosted payment URL.
// The Chariow API key lives only in the CHARIOW_API_KEY environment variable (never in code).
const FALLBACK_URL = "https://zalsport.mychariow.store/prd_vkiqczxt/checkout"

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max)

export default async (req: Request, context: Context) => {
  const apiKey = Netlify.env.get("CHARIOW_API_KEY")
  if (!apiKey) return Response.json({ error: "not_configured", fallback: FALLBACK_URL }, { status: 503 })

  let body: Record<string, any>
  try { body = await req.json() } catch { return Response.json({ error: "bad_request" }, { status: 400 }) }

  const first_name = str(body.first_name, 50)
  const last_name = str(body.last_name, 50)
  const email = str(body.email, 255).toLowerCase()
  const number = str(body.phone, 20).replace(/\D/g, "")
  const country_code = str(body.country, 2).toUpperCase()
  const discount_code = str(body.discount_code, 100).toUpperCase()

  if (!first_name || !last_name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || number.length < 6 || !/^[A-Z]{2}$/.test(country_code)) {
    return Response.json({ error: "invalid_fields" }, { status: 422 })
  }

  const origin = new URL(req.url).origin
  // Chariow does not substitute a sale id into redirect_url, and the sale does not exist yet.
  // So we mint our own unguessable token, put it in the return URL, and link it to the sale below.
  const token = randomToken()
  const returnUrl = `${origin}/gracias/?t=${token}`
  const payload: Record<string, unknown> = {
    product_id: PRODUCT_ID,
    email, first_name, last_name,
    phone: { number, country_code },
    redirect_url: returnUrl,
    customer_ip: context.ip,
    custom_metadata: { source: str(body.source, 30) || "landing" },
  }
  if (discount_code) payload.discount_code = discount_code

  const res = await fetch(`${chariowBase()}/v1/checkout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  })
  const json: any = await res.json().catch(() => ({}))

  if (!res.ok) {
    console.error("Chariow checkout error", res.status, JSON.stringify(json).slice(0, 500))
    const msg = String(json?.message ?? "")
    const error = /phone|téléphone|telefono/i.test(msg) ? "phone_invalid"
      : /email|e-mail|correo/i.test(msg) ? "email_invalid"
      : (/discount|coupon|réduction|promo/i.test(msg) && discount_code) ? "discount_invalid"
      : "chariow_error"
    return Response.json({ error, fallback: FALLBACK_URL }, { status: error === "chariow_error" ? 502 : 422 })
  }

  const step = json?.data?.step
  if (step === "already_purchased") return Response.json({ step, message: json?.data?.message ?? null })
  const url = json?.data?.payment?.checkout_url

  // Remember token -> sale so /gracias/ can later ask Chariow whether this sale is really paid.
  const saleId = json?.data?.purchase?.id
  if (typeof saleId === "string" && saleId) {
    try {
      await orders().setJSON(token, { sale_id: saleId, product_id: PRODUCT_ID, created: Date.now() })
    } catch (e) {
      console.error("orders store write failed", String(e))
    }
  }

  if (step === "completed" || !url) return Response.json({ step: "completed", url: returnUrl })
  return Response.json({ step: "payment", url })
}

export const config: Config = { path: "/api/checkout", method: ["POST"] }
