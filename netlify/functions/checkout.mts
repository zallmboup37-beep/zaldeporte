import type { Config, Context } from "@netlify/functions"

// Creates a Chariow checkout from the landing-page form and returns the hosted payment URL.
// The Chariow API key lives only in the CHARIOW_API_KEY environment variable (never in code).
const PRODUCT_ID = "prd_vkiqczxt"
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
  const payload: Record<string, unknown> = {
    product_id: PRODUCT_ID,
    email, first_name, last_name,
    phone: { number, country_code },
    redirect_url: `${origin}/gracias/`,
    customer_ip: context.ip,
    custom_metadata: { source: str(body.source, 30) || "landing" },
  }
  if (discount_code) payload.discount_code = discount_code

  const res = await fetch("https://api.chariow.com/v1/checkout", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  })
  const json: any = await res.json().catch(() => ({}))

  if (!res.ok) {
    console.error("Chariow checkout error", res.status, JSON.stringify(json).slice(0, 500))
    const msg = String(json?.message ?? "")
    const discountProblem = /discount|code|coupon|réduc|promo/i.test(msg) && discount_code
    return Response.json({ error: discountProblem ? "discount_invalid" : "chariow_error", fallback: FALLBACK_URL }, { status: 502 })
  }

  const step = json?.data?.step
  if (step === "already_purchased") return Response.json({ step, message: json?.data?.message ?? null })
  const url = json?.data?.payment?.checkout_url
  if (step === "completed" || !url) return Response.json({ step: "completed", url: `${origin}/gracias/` })
  return Response.json({ step: "payment", url })
}

export const config: Config = { path: "/api/checkout", method: ["POST"] }
