import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Navigate, useLocation } from "react-router"
import { authApi, onAuthFailure, tokenStore } from "../services/api"
import type { CurrentUser } from "../services/types"
import { LoadingState } from "../components/ui"

type AuthContextValue = {
  user: CurrentUser | null
  /** True until the stored token has been checked against the server. */
  initializing: boolean
  /** A message for the login page (e.g. why the user was signed out). */
  notice: string | null
  setNotice: (notice: string | null) => void
  login: (email: string, password: string, remember: boolean) => Promise<CurrentUser>
  logout: () => Promise<void>
  refresh: () => Promise<CurrentUser | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const userRef = useRef<CurrentUser | null>(null)
  userRef.current = user

  const signOutLocally = useCallback((message: string | null) => {
    tokenStore.clear()
    setUser(null)
    setNotice(message)
  }, [])

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null)
      return null
    }
    try {
      const me = await authApi.me()
      setUser(me)
      return me
    } catch {
      // A 401 is handled by the auth-failure hook below.
      return null
    }
  }, [])

  // Validate any stored token on first load.
  useEffect(() => {
    void refresh().finally(() => setInitializing(false))
  }, [refresh])

  // React to expired sessions / pending accounts reported by any API call.
  useEffect(() => {
    onAuthFailure((error) => {
      if (error.code === "APPROVAL_PENDING") {
        void refresh()
        return
      }
      const wasPending = userRef.current?.status === "PENDING"
      signOutLocally(
        wasPending
          ? "Your registration is no longer pending. If it was declined, your details were removed and you can register again."
          : userRef.current
            ? error.message || "Your session has ended. Please sign in again."
            : null,
      )
    })
  }, [refresh, signOutLocally])

  const login = useCallback(async (email: string, password: string, remember: boolean) => {
    const { token, user: signedIn } = await authApi.login(email, password, remember)
    tokenStore.set(token, remember)
    setNotice(null)
    setUser(signedIn)
    return signedIn
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // Even if the server call fails, forget the token locally.
    }
    signOutLocally(null)
  }, [signOutLocally])

  const value = useMemo(
    () => ({ user, initializing, notice, setNotice, login, logout, refresh }),
    [user, initializing, notice, login, logout, refresh],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
  return ctx
}

type Area = "admin" | "student" | "pending"
const areaPath: Record<Area, CurrentUser["redirectTo"]> = { admin: "/admin", student: "/student", pending: "/pending" }

/**
 * Route guard. The server enforces every permission anyway; this only keeps people on the
 * screens that match their account (admin / approved student / pending applicant).
 */
export function RequireArea({ area, children }: { area: Area; children: ReactNode }) {
  const { user, initializing } = useAuth()
  const location = useLocation()
  if (initializing) return <FullPageLoading />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.redirectTo !== areaPath[area]) return <Navigate to={user.redirectTo} replace />
  return <>{children}</>
}

/** Login / register pages: an already signed-in user goes straight to their area. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { user, initializing } = useAuth()
  if (initializing) return <FullPageLoading />
  if (user) return <Navigate to={user.redirectTo} replace />
  return <>{children}</>
}

function FullPageLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50">
      <LoadingState />
    </div>
  )
}
