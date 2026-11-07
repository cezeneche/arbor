import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseConnection } from '@/lib/db-tls'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createPrismaClient(): PrismaClient {
  // Cap connections per serverless instance. The database pooler runs in session
  // mode with a small client limit (~15), so several concurrent instances each
  // opening the pg default of 10 connections exhausts it. Keep a low ceiling and
  // release idle connections quickly. Raise DB_POOL_MAX once the pooler is moved
  // to transaction mode (which supports many more clients).
  const adapter = new PrismaPg({
    // Verified TLS for any remote database, whatever the URL says: see db-tls.ts.
    ...databaseConnection(process.env.DATABASE_URL),
    max: Number(process.env.DB_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  })
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error'] : [],
  })
}

// Reuse one client per instance in every environment so we don't multiply pools.
export const prisma = globalForPrisma.prisma ?? createPrismaClient()
globalForPrisma.prisma = prisma
