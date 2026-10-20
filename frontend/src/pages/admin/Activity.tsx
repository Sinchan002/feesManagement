import { useState } from "react"
import { Download, FileClock } from "lucide-react"
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Pagination,
  SearchBox,
  Select,
} from "../../components/ui"
import { auditApi } from "../../services/api"
import { errorMessage, formatDateTime, titleCase, useAsync, useDebounced } from "../../lib/format"

const roleTone: Record<string, string> = { ADMIN: "violet", STUDENT: "blue", SYSTEM: "amber" }

export function ActivityPage() {
  const [search, setSearch] = useState("")
  const query = useDebounced(search)
  const [action, setAction] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [page, setPage] = useState(1)
  const [exportError, setExportError] = useState<string | null>(null)
  const params = {
    search: query,
    action,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
  }
  const { data, error, loading, reload } = useAsync(
    () => auditApi.list({ ...params, page, pageSize: 30 }),
    [query, action, from, to, page],
  )
  const actions = (data?.meta.actions as string[] | undefined) ?? []
  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v)
    setPage(1)
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Compliance"
        title="Audit history"
        description="A chronological record of fee, profile, allocation, and reminder actions."
        action={
          <Button variant="secondary" onClick={() => void auditApi.exportCsv(params).catch((e) => setExportError(errorMessage(e)))}>
            <Download className="size-4" /> Export log
          </Button>
        }
      />
      {exportError && <Alert onDismiss={() => setExportError(null)}>{exportError}</Alert>}
      <Card>
        <div className="grid gap-3 border-b border-slate-100 p-4 md:grid-cols-[1fr_auto_auto_auto]">
          <SearchBox value={search} onChange={reset(setSearch)} placeholder="Search audit entries" />
          <div className="md:w-56">
            <Select value={action} onChange={(e) => reset(setAction)(e.target.value)} aria-label="Action type">
              <option value="">All action types</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {titleCase(a)}
                </option>
              ))}
            </Select>
          </div>
          <Input type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} aria-label="From date" />
          <Input type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} aria-label="To date" />
        </div>
        {loading && !data ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.items.length ? (
          <EmptyState icon={<FileClock />} title="No audit entries" description="Actions taken in the app are recorded here." />
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {data.items.map((item) => (
                <div key={item.id} className="flex gap-4 p-5 sm:px-6">
                  <div className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
                    <FileClock className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{titleCase(item.action)}</p>
                      <Badge tone={roleTone[item.actorRole ?? ""] ?? "slate"}>{titleCase(item.actorRole ?? "Unknown")}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{item.summary}</p>
                    <p className="mt-2 text-xs text-slate-400">
                      {formatDateTime(item.createdAt)} • {item.actor ?? "Deleted user"}
                      {item.ip ? ` • IP ${item.ip}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  )
}
