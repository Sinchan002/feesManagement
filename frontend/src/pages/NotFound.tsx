import { Link, useRouteError } from "react-router"
import {
  AlertTriangle,
  ArrowLeft,
  GraduationCap,
  RefreshCw,
} from "lucide-react"
import { Button } from "../components/ui"

export function NotFoundPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
      <div>
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-blue-600 text-white">
          <GraduationCap />
        </div>
        <p className="mt-8 text-sm font-bold text-blue-600">404</p>
        <h1 className="mt-2 text-3xl font-bold">Page not found</h1>
        <p className="mt-3 text-slate-500">
          The page you’re looking for may have moved.
        </p>
        <Link to="/">
          <Button className="mt-6">
            <ArrowLeft className="size-4" /> Back to home
          </Button>
        </Link>
      </div>
    </div>
  )
}

export function RouteErrorPage() {
  const error = useRouteError()
  const message =
    error instanceof Error ? error.message : "We could not load this page."

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
      <div className="max-w-md">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-red-50 text-red-600">
          <AlertTriangle />
        </div>
        <h1 className="mt-6 text-2xl font-bold">Something went wrong</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">{message}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => window.location.reload()}>
            <RefreshCw className="size-4" /> Try again
          </Button>
          <Link to="/">
            <Button variant="secondary">Home</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
