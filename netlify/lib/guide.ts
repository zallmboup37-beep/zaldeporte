// Shared constants and helpers for the "direct delivery" flow (checkout -> /gracias/ -> private PDF).
import { getStore } from "@netlify/blobs"

export const PRODUCT_ID = "prd_vkiqczxt"
// Overridable only so the flow can be tested locally against a fake Chariow server.
export const chariowBase = () => Netlify.env.get("CHARIOW_API_BASE") || "https://api.chariow.com"
// A dedicated read-only key (scope sales.read) is preferred; falls back to the checkout key.
export const salesKey = () => Netlify.env.get("CHARIOW_SALES_KEY") || Netlify.env.get("CHARIOW_API_KEY") || ""

export const GUIDE_KEY = "mentalidad-de-campeon.pdf"
export const ORDER_TTL_MS = 30 * 24 * 3600 * 1000 // a buyer can come back to /gracias/ for 30 days
export const LINK_TTL_MS = 15 * 60 * 1000 // a download link lives 15 minutes

export const orders = () => getStore({ name: "orders", consistency: "strong" })
export const links = () => getStore({ name: "links", consistency: "strong" })
export const guide = () => getStore({ name: "private-files", consistency: "strong" })

// 128 bits of randomness, hex (cannot be guessed).
export const randomToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(16))
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("")
}
export const isToken = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{32}$/.test(v)
