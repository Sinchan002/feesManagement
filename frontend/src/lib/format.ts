import { useCallback, useEffect, useRef, useState } from "react"

export const inr = (n: number | null | undefined) =>
  `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"

export const formatDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "—"

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`
  if (s < 172800) return "Yesterday"
  return formatDate(iso)
}

/** "YYYY-MM" for the current month (local time). */
export const currentPeriod = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

export const shiftPeriod = (period: string, delta: number) => {
  const [y, m] = period.split("-").map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

export const periodLabel = (period: string) => {
  const [y, m] = period.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
}

export const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  CARD: "Card",
  NET_BANKING: "Net banking",
  WALLET: "Wallet",
  ONLINE: "Online",
  OTHER: "Other",
}
export const methodLabel = (m: string) => METHOD_LABELS[m] ?? m

export const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]!.toUpperCase())
    .join("")

export const errorMessage = (e: unknown, fallback = "Something went wrong. Please try again.") =>
  e instanceof Error ? e.message : fallback

/**
 * Loads data from the API and tracks loading / error state.
 * `reload()` re-runs the loader; results from stale requests are ignored.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const latest = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps)

  const run = useCallback(async () => {
    const id = ++latest.current
    setLoading(true)
    setError(null)
    try {
      const result = await load()
      if (id === latest.current) setData(result)
    } catch (e) {
      if (id === latest.current) setError(errorMessage(e))
    } finally {
      if (id === latest.current) setLoading(false)
    }
  }, [load])

  useEffect(() => {
    void run()
  }, [run])

  return { data, error, loading, reload: run, setData }
}

/** Debounce a fast-changing value such as a search box. */
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * A date picked in a form ("2026-11-01") → ISO timestamp for the server. Today means "right now"
 * (noon today could still be in the future, which the server refuses); other days use noon.
 */
export const dateInputToIso = (day: string) =>
  day === todayISO() ? new Date().toISOString() : new Date(`${day}T12:00:00`).toISOString()
