import { useEffect, useRef, useState } from "react"
import { Check, QrCode, Trash2, Upload } from "lucide-react"
import { Alert, Button, Card, Field, Input, LoadingState, Spinner } from "../../components/ui"
import { upiApi } from "../../services/api"
import type { UpiConfig } from "../../services/types"
import { errorMessage, useAsync } from "../../lib/format"

const MAX_BYTES = 1024 * 1024
const UPI_ID_RE = /^[a-z0-9._-]{2,64}@[a-z][a-z0-9]{1,30}$/i

/** Phone screenshots are often larger than the 1 MB limit; shrink those, keep small files untouched. */
async function fitImage(file: File): Promise<Blob> {
  if (file.size <= 900 * 1024) return file
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const toBlob = (type: string, q?: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, q))
  const png = await toBlob("image/png")
  if (png && png.size <= MAX_BYTES) return png
  const jpeg = await toBlob("image/jpeg", 0.92)
  if (jpeg && jpeg.size <= MAX_BYTES) return jpeg
  throw new Error("That image is too large. Use a smaller screenshot or photo of the QR code.")
}

/** Settings card where the teacher saves the UPI ID and QR code that students pay to. */
export function UpiDetailsCard() {
  const remote = useAsync(() => upiApi.config(), [])
  const [config, setConfig] = useState<UpiConfig | null>(null)
  const [upiId, setUpiId] = useState("")
  const [payee, setPayee] = useState("")
  const [busy, setBusy] = useState<"details" | "qr" | null>(null)
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!remote.data) return
    setConfig(remote.data)
    setUpiId(remote.data.upiId)
    setPayee(remote.data.payeeName)
  }, [remote.data])

  if (remote.loading && !config) return <Card className="p-6"><LoadingState /></Card>
  if (!config) return null

  const idProblem = upiId.trim() && !UPI_ID_RE.test(upiId.trim()) ? "Enter a valid UPI ID, like name@bank" : null
  const dirty = upiId.trim().toLowerCase() !== config.upiId || payee.trim() !== config.payeeName

  const saveDetails = async () => {
    setMsg(null)
    if (!UPI_ID_RE.test(upiId.trim())) return setMsg({ tone: "red", text: "Enter a valid UPI ID, like name@bank." })
    if (payee.trim().length < 2) return setMsg({ tone: "red", text: "Enter the name that appears in UPI apps." })
    setBusy("details")
    try {
      setConfig(await upiApi.saveDetails({ upiId: upiId.trim(), payeeName: payee.trim() }))
      setMsg({ tone: "green", text: "UPI details saved. Students can see them now." })
    } catch (e) {
      setMsg({ tone: "red", text: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const chooseFile = async (file: File | undefined) => {
    if (!file) return
    setMsg(null)
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setMsg({ tone: "red", text: "Choose a PNG, JPG or WebP image." })
    setBusy("qr")
    try {
      setConfig(await upiApi.uploadQr(await fitImage(file)))
      setMsg({ tone: "green", text: "QR code uploaded. Scan it with your phone to be sure it reads correctly." })
    } catch (e) {
      setMsg({ tone: "red", text: errorMessage(e) })
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  const removeQr = async () => {
    if (!window.confirm("Remove the QR code? Students will still see your UPI ID.")) return
    setBusy("qr")
    try {
      setConfig(await upiApi.removeQr())
      setMsg({ tone: "green", text: "QR code removed." })
    } catch (e) {
      setMsg({ tone: "red", text: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600">
          <QrCode className="size-5" />
        </div>
        <div>
          <h2 className="font-bold">UPI payment details</h2>
          <p className="mt-1 text-sm text-slate-500">
            Students pay to this UPI ID or QR code, then enter their reference number. You verify each one on the Payments page
            before the fee is marked paid.
          </p>
        </div>
      </div>
      <div className="mt-5 space-y-4">
        {msg && (
          <Alert tone={msg.tone} onDismiss={() => setMsg(null)}>
            {msg.text}
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="UPI ID" error={idProblem ?? undefined}>
            <Input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="e.g. srikrishna@okhdfcbank" autoComplete="off" />
          </Field>
          <Field label="Name shown in UPI apps">
            <Input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="e.g. SriKrishna Physics" maxLength={60} />
          </Field>
        </div>
        <Button onClick={saveDetails} disabled={busy !== null || !dirty}>
          {busy === "details" ? <Spinner /> : <Check className="size-4" />} Save UPI details
        </Button>

        <div className="border-t border-slate-100 pt-4">
          <p className="text-sm font-medium text-slate-700">QR code</p>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <div className="grid size-36 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              {config.qrDataUrl ? (
                <img src={config.qrDataUrl} alt="Your UPI QR code" className="size-full object-contain" />
              ) : (
                <QrCode className="size-10 text-slate-300" />
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => void chooseFile(e.target.files?.[0])}
              />
              <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={busy !== null || !config.configured}>
                {busy === "qr" ? <Spinner /> : <Upload className="size-4" />} {config.hasQr ? "Replace QR image" : "Upload QR image"}
              </Button>
              {config.hasQr && (
                <Button variant="danger" onClick={removeQr} disabled={busy !== null}>
                  <Trash2 className="size-4" /> Remove
                </Button>
              )}
              <p className="max-w-xs text-xs text-slate-400">
                {config.configured
                  ? "PNG, JPG or WebP, up to 1 MB. Your UPI app's \"Show QR code\" screenshot works well."
                  : "Save your UPI ID first, then upload the QR code."}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
