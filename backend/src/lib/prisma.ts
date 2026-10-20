import { Prisma, PrismaClient } from "@prisma/client"

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
})

export type Tx = Prisma.TransactionClient
export type Db = PrismaClient | Tx
