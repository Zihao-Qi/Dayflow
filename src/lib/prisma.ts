import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
let client: PrismaClient | undefined;

/**
 * Open Prisma on first use, never at module evaluation.
 *
 * Startup restore replaces the database file before Dayflow serves anything, so
 * no client may exist while that runs. Constructing at import time left the
 * ordering to the import graph; deferring to the first call makes it a property
 * of the code. The instance is still a process-wide singleton, and an injected
 * `globalThis.prisma` still wins so a test can supply its own.
 */
export function getPrisma(): PrismaClient {
  const injected = globalForPrisma.prisma;
  if (injected) return injected;
  if (client) return client;
  client = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
  });
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = client;
  return client;
}
