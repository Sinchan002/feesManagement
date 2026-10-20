import nodemailer from "nodemailer"
import { env, isTest } from "../config/env"

export type Mail = { to: string | string[]; subject: string; text: string; replyTo?: string }

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    })
  : null

/** Mails captured in test mode, so tests can read reset links. */
export const sentMail: Mail[] = []

export const mailerConfigured = () => Boolean(transport)

/** Send an email. Failures are logged, never thrown — mail must not break a request. */
export async function sendMail(mail: Mail): Promise<boolean> {
  if (isTest) {
    sentMail.push(mail)
    return true
  }
  if (!transport) {
    console.info(`[mail:console] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`)
    return true
  }
  try {
    await transport.sendMail({ from: env.MAIL_FROM, ...mail })
    return true
  } catch (error) {
    console.error("[mail] send failed:", (error as Error).message)
    return false
  }
}
