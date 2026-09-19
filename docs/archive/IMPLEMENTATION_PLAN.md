# Arbor — Comprehensive Implementation Plan v2.0

**Stack:** Next.js 14 · TypeScript · PostgreSQL · Prisma · NextAuth · Inngest · Vercel Blob · Claude API (claude-sonnet-4-6)  
**Status:** Active — work top to bottom, one sprint at a time  
**Rule:** Do not start the next sprint until the current sprint's acceptance test passes.

---

## Table of Contents

1. [Project Scaffold](#project-scaffold)
2. [Sprint 1.0 — Environment and Tooling](#sprint-10--environment-and-tooling)
3. [Sprint 1.1 — Authentication](#sprint-11--authentication)
4. [Sprint 1.2 — File Storage](#sprint-12--file-storage)
5. [Sprint 1.3 — Database Schema](#sprint-13--database-schema)
6. [Sprint 1.4 — Design System](#sprint-14--design-system)
7. [Sprint 1.5 — Admissibility Framework](#sprint-15--admissibility-framework)
8. [Sprint 1.6 — Job Queue (Inngest)](#sprint-16--job-queue-inngest)
9. [Sprint 1.7 — Document Extraction Engine (Layer 1)](#sprint-17--document-extraction-engine-layer-1)
10. [Sprint 1.8 — Calculation Engine (Layer 2)](#sprint-18--calculation-engine-layer-2)
11. [Sprint 1.9 — Cross-Validation Engine](#sprint-19--cross-validation-engine)
12. [Sprint 1.10 — Notifications](#sprint-110--notifications)
13. [Sprint 1.11 — API Routes](#sprint-111--api-routes)
14. [Sprint 1.12 — Supplier Portal UI](#sprint-112--supplier-portal-ui)
15. [Sprint 1.13 — Buyer Interface UI](#sprint-113--buyer-interface-ui)
16. [Phase 2 — Expansion](#phase-2--expansion-months-718)
17. [Phase 3 — Institutional](#phase-3--institutional-months-1936)
18. [Folder Structure](#folder-structure)
19. [Testing Requirements](#testing-requirements)
20. [Environment Variables](#environment-variables)
21. [Sprint Sequence Summary](#sprint-sequence-summary)

---

## Project Scaffold

Run once in the terminal before any Claude Code work begins.

```bash
npx create-next-app@latest arbor --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd arbor

# Core
npm install prisma @prisma/client
npm install @anthropic-ai/sdk
npm install zod

# Auth
npm install next-auth@beta @auth/prisma-adapter
npm install bcryptjs @types/bcryptjs

# Job queue
npm install inngest

# File storage
npm install @vercel/blob

# Email (notifications)
npm install resend

# Dev
npm install -D jest @types/jest ts-jest @testing-library/react

npx prisma init
npm run dev
```

After scaffold, all work is done through Claude Code in VS Code. Terminal is only needed to run `npm run dev`, `npx prisma migrate dev`, and test runs.

---

## Sprint 1.0 — Environment and Tooling

### 1.0.1 Environment variables

Create `.env.local`:

```bash
DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000
ANTHROPIC_API_KEY=sk-ant-...
AUDIT_CHAIN_SECRET=<openssl rand -base64 32>
BLOB_READ_WRITE_TOKEN=...
RESEND_API_KEY=re_...
INNGEST_EVENT_KEY=...
INNGEST_SIGNING_KEY=...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Create `.env.example` with the same keys and description values. Commit `.env.example`. Never commit `.env.local`.

### 1.0.2 Jest configuration

`jest.config.ts`:

```typescript
import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testMatch: ['**/__tests__/**/*.test.ts'],
  globals: {
    'ts-jest': { tsconfig: { strict: true } },
  },
}

export default config
```

**Acceptance test:** `npx jest --passWithNoTests` exits 0.

---

## Sprint 1.1 — Authentication

Authentication is a prerequisite for every route and every audit entry. Build it before the schema, routes, or UI.

### Auth configuration

`src/lib/auth.ts`:

```typescript
import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Credentials from 'next-auth/providers/credentials'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { compare } from 'bcryptjs'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const parsed = z.object({
          email: z.string().email(),
          password: z.string().min(8),
        }).safeParse(credentials)

        if (!parsed.success) return null

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          include: { entity: true },
        })

        if (!user || !user.passwordHash) return null
        const valid = await compare(parsed.data.password, user.passwordHash)
        if (!valid) return null

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          entityId: user.entityId,
          role: user.role,
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.entityId = (user as any).entityId
        token.role = (user as any).role
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.sub!
      session.user.entityId = token.entityId as string
      session.user.role = token.role as string
      return session
    },
  },
})
```

`src/lib/auth-helpers.ts`:

```typescript
import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function requireAuth() {
  const session = await auth()
  if (!session?.user) {
    return {
      session: null,
      response: NextResponse.json(
        { error: 'Unauthorised', code: 'AUTH_REQUIRED' },
        { status: 401 }
      ),
    }
  }
  return { session, response: null }
}
```

`src/app/api/auth/[...nextauth]/route.ts`:

```typescript
import { handlers } from '@/lib/auth'
export const { GET, POST } = handlers
```

`src/middleware.ts`:

```typescript
import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const isAuthed = !!req.auth
  const isPublic = req.nextUrl.pathname.startsWith('/login') ||
                   req.nextUrl.pathname.startsWith('/api/auth')

  if (!isAuthed && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

**Acceptance test:** Unauthenticated request to `/dashboard` redirects to `/login`. Authenticated session persists across page refreshes.

---

## Sprint 1.2 — File Storage

Documents are stored in Vercel Blob. The database stores only the blob URL, never the file content.

`src/lib/storage.ts`:

```typescript
import { put, del } from '@vercel/blob'

export async function storeDocument(
  file: File,
  entityId: string
): Promise<{ url: string; pathname: string }> {
  const extension = file.name.split('.').pop()
  const pathname = `documents/${entityId}/${Date.now()}.${extension}`

  const blob = await put(pathname, file, {
    access: 'private',
    contentType: file.type,
  })

  return { url: blob.url, pathname: blob.pathname }
}

export async function deleteDocument(url: string): Promise<void> {
  await del(url)
}
```

`src/lib/storage-retrieval.ts`:

```typescript
export async function fetchDocumentAsBase64(blobUrl: string): Promise<{
  base64: string
  mediaType: 'application/pdf' | 'image/jpeg' | 'image/png'
}> {
  const response = await fetch(blobUrl, {
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  })

  if (!response.ok) throw new Error(`Failed to fetch document: ${response.status}`)

  const contentType = response.headers.get('content-type') ?? ''
  const buffer = await response.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')

  const mediaType =
    contentType.includes('pdf') ? 'application/pdf' :
    contentType.includes('png') ? 'image/png' :
    'image/jpeg'

  return { base64, mediaType }
}
```

**Acceptance test:** Upload a PDF via `storeDocument`. Confirm the URL is returned. Confirm `fetchDocumentAsBase64` retrieves it and returns valid base64. Confirm the blob is inaccessible without the token.

---

## Sprint 1.3 — Database Schema

`prisma/schema.prisma` — complete schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ── NEXTAUTH TABLES ───────────────────────────────────────────────────────────

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

// ── ENTITY ────────────────────────────────────────────────────────────────────

model Entity {
  id                 String   @id @default(cuid())
  legalName          String
  registrationNumber String?
  country            String
  sector             String
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  users             User[]
  documents         Document[]
  dataRecords       DataRecord[]
  auditChain        AuditEntry[]
  outgoingRequests  DataRequest[]      @relation("BuyerRequests")
  incomingRequests  DataRequest[]      @relation("SupplierRequests")
  emissionFactors   EmissionFactor[]
  notifications     Notification[]
  dataAccess        DataAccessGrant[]  @relation("GrantorEntity")
  receivedAccess    DataAccessGrant[]  @relation("GranteeEntity")
  apiKeys           ApiKey[]
}

// ── USER ──────────────────────────────────────────────────────────────────────

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String?
  role         UserRole @default(CONTRIBUTOR)
  entityId     String
  entity       Entity   @relation(fields: [entityId], references: [id])
  createdAt    DateTime @default(now())

  accounts     Account[]
  sessions     Session[]
  submissions  DataRecord[]
  requests     DataRequest[]
}

enum UserRole {
  ADMIN
  CONTRIBUTOR
  VIEWER
}

// ── DOCUMENT ──────────────────────────────────────────────────────────────────

model Document {
  id            String         @id @default(cuid())
  entityId      String
  entity        Entity         @relation(fields: [entityId], references: [id])
  fileName      String
  fileType      String
  documentType  DocumentType
  blobUrl       String
  submittedAt   DateTime       @default(now())
  submittedById String
  status        DocumentStatus @default(PENDING)

  dataRecords    DataRecord[]
  extractionJobs ExtractionJob[]
}

enum DocumentType {
  ELECTRICITY_BILL
  GAS_BILL
  FUEL_RECEIPT
  RENEWABLE_CERTIFICATE
  PRODUCTION_LOG
  MATERIAL_INTAKE
  BILL_OF_MATERIALS
  PROCESS_DATA_SHEET
  FREIGHT_INVOICE
  DELIVERY_NOTE
  CUSTOMS_DECLARATION
  BILL_OF_LADING
  SUPPLIER_INVOICE
  PURCHASE_ORDER
  SUPPLIER_QUESTIONNAIRE
  EMISSIONS_FACTOR_DOC
  ENVIRONMENTAL_CERTIFICATE
  CARBON_FOOTPRINT_REPORT
  WATER_RECORD
  WASTE_RECORD
  CROP_YIELD_RECORD
  FERTILISER_RECORD
  LIVESTOCK_RECORD
  LAND_USE_CERTIFICATE
  CBAM_DECLARATION
  ESG_REPORT
  AUDIT_REPORT
  PRODUCT_CERTIFICATE
  CHAIN_OF_CUSTODY
  OTHER
}

enum DocumentStatus {
  PENDING
  EXTRACTING
  REVIEW_REQUIRED
  ACCEPTED
  REJECTED
}

// ── EXTRACTION JOB ────────────────────────────────────────────────────────────

model ExtractionJob {
  id            String           @id @default(cuid())
  documentId    String
  document      Document         @relation(fields: [documentId], references: [id])
  status        ExtractionStatus @default(QUEUED)
  startedAt     DateTime?
  completedAt   DateTime?
  errorMessage  String?          @db.Text
  rawOutput     Json?

  extractedFields ExtractedField[]
}

enum ExtractionStatus {
  QUEUED
  RUNNING
  COMPLETE
  FAILED
}

// ── EXTRACTED FIELD ───────────────────────────────────────────────────────────

model ExtractedField {
  id              String             @id @default(cuid())
  extractionJobId String
  extractionJob   ExtractionJob      @relation(fields: [extractionJobId], references: [id])
  fieldName       String
  admissibility   FieldAdmissibility
  rawValue        String?
  rawUnit         String?
  normalisedValue Float?
  normalisedUnit  String?
  sourceText      String             @db.Text
  confidenceScore Float
  flagged         Boolean            @default(false)
  flagReason      String?
  confirmedBy     String?
  confirmedAt     DateTime?
}

enum FieldAdmissibility {
  COMPULSORY
  CONDITIONAL
  OPTIONAL
}

// ── DATA RECORD ───────────────────────────────────────────────────────────────

model DataRecord {
  id               String          @id @default(cuid())
  entityId         String
  entity           Entity          @relation(fields: [entityId], references: [id])
  documentId       String?
  document         Document?       @relation(fields: [documentId], references: [id])
  domain           DataDomain
  scope3Category   Int?            // GHG Protocol Scope 3 category 1-15, null if not applicable
  fieldName        String
  value            Float
  unit             String          // SI base unit
  originalValue    Float?
  originalUnit     String?
  periodStart      DateTime
  periodEnd        DateTime
  sourceText       String?         @db.Text
  confidenceScore  Float           @default(1.0)
  trustTier        TrustTier
  extractionMethod ExtractionMethod
  submittedAt      DateTime        @default(now())
  submittedById    String
  submittedBy      User            @relation(fields: [submittedById], references: [id])
  supersededById   String?
  isActive         Boolean         @default(true)
  auditHash        String

  validationFlags  ValidationFlag[]
}

enum DataDomain {
  ENERGY
  MATERIALS
  PRODUCTION
  LOGISTICS
  EMISSIONS
  AGRICULTURE
  WASTE_AND_WATER
  COMPLIANCE
}

enum TrustTier {
  A
  B
  C
}

enum ExtractionMethod {
  DOCUMENT_AI
  MANUAL_ENTRY
  SYSTEM_INTEGRATION
  DEFAULT_FACTOR
}

// ── VALIDATION FLAG ───────────────────────────────────────────────────────────

model ValidationFlag {
  id           String     @id @default(cuid())
  dataRecordId String
  dataRecord   DataRecord @relation(fields: [dataRecordId], references: [id])
  flagType     FlagType
  message      String     @db.Text
  severity     Severity
  resolvedAt   DateTime?
  resolvedNote String?
}

enum FlagType {
  ENTITY_MISMATCH
  DATE_INVALID
  UNIT_INCONSISTENCY
  COMPLETENESS_GAP
  INTERNAL_INCONSISTENCY
  LOW_CONFIDENCE
  DUPLICATE
  CROSS_DOC_DISCREPANCY
  GENERIC_VALUE
  CODE_INSUFFICIENT
  EXPIRED_CERTIFICATE
  DOUBLE_COUNTING
  MISSING_CONDITIONAL_FIELD
}

enum Severity {
  INFO
  WARNING
  CRITICAL
}

// ── AUDIT ENTRY ───────────────────────────────────────────────────────────────

model AuditEntry {
  id           String   @id @default(cuid())
  entityId     String
  entity       Entity   @relation(fields: [entityId], references: [id])
  recordId     String
  eventType    String   // CREATED, UPDATED, SUPERSEDED, FLAG_RAISED, FLAG_RESOLVED
  payload      Json
  hash         String
  previousHash String?
  createdAt    DateTime @default(now())
}

// ── DATA REQUEST ──────────────────────────────────────────────────────────────

model DataRequest {
  id               String        @id @default(cuid())
  buyerEntityId    String
  buyerEntity      Entity        @relation("BuyerRequests", fields: [buyerEntityId], references: [id])
  supplierEntityId String
  supplierEntity   Entity        @relation("SupplierRequests", fields: [supplierEntityId], references: [id])
  requestedById    String
  requestedBy      User          @relation(fields: [requestedById], references: [id])
  domain           DataDomain
  periodStart      DateTime
  periodEnd        DateTime
  requiredFields   Json
  deadline         DateTime?
  status           RequestStatus @default(PENDING)
  createdAt        DateTime      @default(now())
  respondedAt      DateTime?
  notes            String?       @db.Text
}

enum RequestStatus {
  PENDING
  SUBMITTED
  ACCEPTED
  QUERY_RAISED
  CLOSED
}

// ── DATA ACCESS GRANT ─────────────────────────────────────────────────────────

model DataAccessGrant {
  id              String     @id @default(cuid())
  grantorEntityId String
  grantorEntity   Entity     @relation("GrantorEntity", fields: [grantorEntityId], references: [id])
  granteeEntityId String
  granteeEntity   Entity     @relation("GranteeEntity", fields: [granteeEntityId], references: [id])
  domain          DataDomain?
  periodStart     DateTime?
  periodEnd       DateTime?
  grantedAt       DateTime   @default(now())
  revokedAt       DateTime?
  isActive        Boolean    @default(true)
}

// ── NOTIFICATION ──────────────────────────────────────────────────────────────

model Notification {
  id        String           @id @default(cuid())
  entityId  String
  entity    Entity           @relation(fields: [entityId], references: [id])
  type      NotificationType
  payload   Json
  sentAt    DateTime?
  readAt    DateTime?
  createdAt DateTime         @default(now())
}

enum NotificationType {
  DATA_REQUEST_RECEIVED
  DATA_REQUEST_RESPONDED
  EXTRACTION_COMPLETE
  FLAG_RAISED
  TIER_UPGRADED
  ACCESS_GRANTED
  ACCESS_REVOKED
}

// ── EMISSION FACTOR ───────────────────────────────────────────────────────────

model EmissionFactor {
  id           String   @id @default(cuid())
  entityId     String?  // null = platform-wide; set = entity-specific derived factor (Phase 3)
  entity       Entity?  @relation(fields: [entityId], references: [id])
  activityType String
  source       String
  version      String
  year         Int
  factor       Float
  unit         String
  citation     String   @db.Text
  isDerived    Boolean  @default(false)
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
}

// ── CROSS-VALIDATION RESULT ───────────────────────────────────────────────────

model CrossValidationResult {
  id               String   @id @default(cuid())
  entityId         String
  documentAId      String
  documentBId      String
  fieldName        String
  valueA           Float
  valueB           Float
  tolerancePercent Float
  discrepancyPercent Float
  passed           Boolean
  resolvedAt       DateTime?
  resolvedNote     String?
  createdAt        DateTime @default(now())
}

// ── API KEY (Phase 2 — external API) ─────────────────────────────────────────

model ApiKey {
  id        String   @id @default(cuid())
  entityId  String
  entity    Entity   @relation(fields: [entityId], references: [id])
  keyHash   String   @unique
  label     String
  lastUsed  DateTime?
  createdAt DateTime @default(now())
  revokedAt DateTime?
  isActive  Boolean  @default(true)
}
```

After writing the schema:

```bash
npx prisma migrate dev --name init
npx prisma generate
```

`src/lib/prisma.ts`:

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['error'] : [] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

**Acceptance test:** `npx prisma db push` completes without errors. All tables visible in `npx prisma studio`.

---

## Sprint 1.4 — Design System

`src/lib/design-system.ts`:

```typescript
export const colours = {
  navy: '#1B2F4A',
  navyHover: '#243A5C',
  background: '#F8F8F6',
  surface: '#FFFFFF',
  textPrimary: '#141414',
  textSecondary: '#636363',
  textTertiary: '#A0A09A',
  border: '#E6E6E2',
  green: '#2A6048',
  greenBg: '#EFF9F4',
  amber: '#8A3C0A',
  amberBg: '#FDF8EE',
  red: '#8F1A1A',
  redBg: '#FDF1F1',
} as const

export const typography = {
  fontFamily: 'Inter, -apple-system, sans-serif',
  weights: { light: 300, medium: 500 } as const,
  sizes: {
    hero: '52px', lg: '24px', base: '15px',
    sm: '13px', xs: '11px', label: '10px',
  },
  tracking: {
    tight: '-0.03em', normal: '0', wide: '0.08em', wider: '0.12em',
  },
} as const

export const spacing = {
  1: '8px', 2: '16px', 3: '24px', 4: '32px',
  5: '40px', 6: '48px', 7: '56px', 8: '64px', 10: '80px',
} as const

export const trustTierConfig = {
  A: {
    label: 'Document-verified',
    colour: colours.green,
    bg: colours.greenBg,
    description: 'Extracted from a source document. Source text recorded.',
  },
  B: {
    label: 'Supplier-declared',
    colour: colours.amber,
    bg: colours.amberBg,
    description: 'Declared by the supplier. No document backing.',
  },
  C: {
    label: 'Default estimate',
    colour: colours.textTertiary,
    bg: colours.background,
    description: 'Published default factor applied. Not actual activity data.',
  },
} as const

export const confidenceThreshold = 0.85
```

**Acceptance test:** Import `colours` in any component and confirm TypeScript resolves all keys without error.

---

## Sprint 1.5 — Admissibility Framework

This module sits between Layer 1 extraction and DataRecord creation. It applies the admissibility spec rules to every extraction result and returns a trust tier and a list of flags. This is the module absent from the original plan.

### Field definitions

`src/lib/extraction/field-definitions.ts`:

```typescript
export type FieldAdmissibility = 'compulsory' | 'conditional' | 'optional'

export interface FieldDefinition {
  name: string
  admissibility: FieldAdmissibility
  condition?: string
  conditionFn?: (fields: Record<string, string | null>) => boolean
}

export const DOCUMENT_FIELD_DEFINITIONS: Record<string, FieldDefinition[]> = {
  ELECTRICITY_BILL: [
    { name: 'account_holder_name', admissibility: 'compulsory' },
    { name: 'site_address', admissibility: 'compulsory' },
    { name: 'meter_reference', admissibility: 'compulsory' },
    { name: 'period_start', admissibility: 'compulsory' },
    { name: 'period_end', admissibility: 'compulsory' },
    { name: 'total_consumption_kwh', admissibility: 'compulsory' },
    { name: 'read_type', admissibility: 'compulsory' },
    { name: 'supplier_name', admissibility: 'compulsory' },
    { name: 'invoice_number', admissibility: 'compulsory' },
    { name: 'invoice_date', admissibility: 'compulsory' },
    { name: 'tariff_name', admissibility: 'optional' },
    { name: 'unit_rate_p_per_kwh', admissibility: 'optional' },
    { name: 'standing_charge', admissibility: 'optional' },
    { name: 'vat_number', admissibility: 'optional' },
  ],

  GAS_BILL: [
    { name: 'account_holder_name', admissibility: 'compulsory' },
    { name: 'site_address', admissibility: 'compulsory' },
    { name: 'meter_reference', admissibility: 'compulsory' },
    { name: 'period_start', admissibility: 'compulsory' },
    { name: 'period_end', admissibility: 'compulsory' },
    { name: 'total_consumption_kwh', admissibility: 'compulsory' },
    { name: 'read_type', admissibility: 'compulsory' },
    { name: 'supplier_name', admissibility: 'compulsory' },
    { name: 'invoice_number', admissibility: 'compulsory' },
    { name: 'invoice_date', admissibility: 'compulsory' },
    {
      name: 'total_consumption_m3',
      admissibility: 'conditional',
      condition: 'kWh figure is derived from m³',
      conditionFn: (f) => f['calorific_value'] !== null,
    },
    {
      name: 'calorific_value',
      admissibility: 'conditional',
      condition: 'm³ to kWh conversion present in document',
      conditionFn: (f) => f['total_consumption_m3'] !== null,
    },
    {
      name: 'calorific_value_unit',
      admissibility: 'conditional',
      condition: 'calorific_value is present',
      conditionFn: (f) => f['calorific_value'] !== null,
    },
  ],

  FUEL_RECEIPT: [
    { name: 'purchaser_name', admissibility: 'compulsory' },
    { name: 'fuel_type', admissibility: 'compulsory' },
    { name: 'quantity', admissibility: 'compulsory' },
    { name: 'unit', admissibility: 'compulsory' },
    { name: 'purchase_date', admissibility: 'compulsory' },
    { name: 'supplier_name', admissibility: 'compulsory' },
    { name: 'receipt_or_invoice_number', admissibility: 'compulsory' },
    { name: 'use_type', admissibility: 'compulsory' },
    {
      name: 'site_or_vehicle_reference',
      admissibility: 'conditional',
      condition: 'use_type is STATIONARY_COMBUSTION or TRANSPORT',
      conditionFn: (f) =>
        f['use_type'] === 'STATIONARY_COMBUSTION' || f['use_type'] === 'TRANSPORT',
    },
  ],

  RENEWABLE_CERTIFICATE: [
    { name: 'certificate_type', admissibility: 'compulsory' },
    { name: 'issuing_body', admissibility: 'compulsory' },
    { name: 'certificate_number', admissibility: 'compulsory' },
    { name: 'holder_name', admissibility: 'compulsory' },
    { name: 'vintage_year', admissibility: 'compulsory' },
    { name: 'quantity_mwh', admissibility: 'compulsory' },
    { name: 'technology_type', admissibility: 'compulsory' },
    { name: 'generation_country', admissibility: 'compulsory' },
    { name: 'expiry_date', admissibility: 'compulsory' },
  ],

  PRODUCTION_LOG: [
    { name: 'entity_name', admissibility: 'compulsory' },
    { name: 'site_name', admissibility: 'compulsory' },
    { name: 'product_type', admissibility: 'compulsory' },
    { name: 'product_specification', admissibility: 'compulsory' },
    { name: 'quantity_produced', admissibility: 'compulsory' },
    { name: 'unit', admissibility: 'compulsory' },
    { name: 'period_start', admissibility: 'compulsory' },
    { name: 'period_end', admissibility: 'compulsory' },
    { name: 'process_stage', admissibility: 'compulsory' },
    { name: 'log_or_batch_reference', admissibility: 'compulsory' },
    { name: 'energy_consumption_total', admissibility: 'optional' },
    {
      name: 'energy_unit',
      admissibility: 'conditional',
      condition: 'energy_consumption_total is present',
      conditionFn: (f) => f['energy_consumption_total'] !== null,
    },
  ],

  MATERIAL_INTAKE: [
    { name: 'receiving_entity', admissibility: 'compulsory' },
    { name: 'receiving_site', admissibility: 'compulsory' },
    { name: 'supplier_name', admissibility: 'compulsory' },
    { name: 'material_type', admissibility: 'compulsory' },
    { name: 'material_specification', admissibility: 'compulsory' },
    { name: 'quantity', admissibility: 'compulsory' },
    { name: 'unit', admissibility: 'compulsory' },
    { name: 'delivery_date', admissibility: 'compulsory' },
    { name: 'delivery_note_reference', admissibility: 'compulsory' },
    { name: 'purchase_order_reference', admissibility: 'conditional', condition: 'entity uses PO process' },
    { name: 'country_of_origin', admissibility: 'optional' },
    { name: 'supplier_invoice_reference', admissibility: 'optional' },
  ],

  BILL_OF_MATERIALS: [
    { name: 'entity_name', admissibility: 'compulsory' },
    { name: 'product_type', admissibility: 'compulsory' },
    { name: 'product_specification', admissibility: 'compulsory' },
    { name: 'bom_version', admissibility: 'compulsory' },
    { name: 'effective_date', admissibility: 'compulsory' },
    { name: 'line_items', admissibility: 'compulsory' },
    { name: 'total_mass_per_unit', admissibility: 'optional' },
    {
      name: 'total_mass_unit',
      admissibility: 'conditional',
      condition: 'total_mass_per_unit is present',
      conditionFn: (f) => f['total_mass_per_unit'] !== null,
    },
  ],

  PROCESS_DATA_SHEET: [
    { name: 'entity_name', admissibility: 'compulsory' },
    { name: 'site_name', admissibility: 'compulsory' },
    { name: 'process_type', admissibility: 'compulsory' },
    { name: 'period_start', admissibility: 'compulsory' },
    { name: 'period_end', admissibility: 'compulsory' },
    { name: 'inputs', admissibility: 'compulsory' },
    { name: 'outputs', admissibility: 'compulsory' },
    { name: 'energy_consumption', admissibility: 'optional' },
    {
      name: 'energy_unit',
      admissibility: 'conditional',
      condition: 'energy_consumption is present',
      conditionFn: (f) => f['energy_consumption'] !== null,
    },
    {
      name: 'emission_factors_cited',
      admissibility: 'conditional',
      condition: 'document contains calculated emissions figures',
    },
  ],

  FREIGHT_INVOICE: [
    { name: 'carrier_name', admissibility: 'compulsory' },
    { name: 'shipper_name', admissibility: 'compulsory' },
    { name: 'consignee_name', admissibility: 'compulsory' },
    { name: 'origin_city', admissibility: 'compulsory' },
    { name: 'origin_country', admissibility: 'compulsory' },
    { name: 'destination_city', admissibility: 'compulsory' },
    { name: 'destination_country', admissibility: 'compulsory' },
    { name: 'mode_of_transport', admissibility: 'compulsory' },
    { name: 'shipment_weight', admissibility: 'compulsory' },
    { name: 'weight_unit', admissibility: 'compulsory' },
    { name: 'shipment_date', admissibility: 'compulsory' },
    { name: 'invoice_number', admissibility: 'compulsory' },
    { name: 'invoice_date', admissibility: 'compulsory' },
    {
      name: 'multimodal_leg_breakdown',
      admissibility: 'conditional',
      condition: 'mode_of_transport is MULTIMODAL',
      conditionFn: (f) => f['mode_of_transport'] === 'MULTIMODAL',
    },
    { name: 'distance_km', admissibility: 'optional' },
    { name: 'container_reference', admissibility: 'optional' },
  ],

  DELIVERY_NOTE: [
    { name: 'shipper_name', admissibility: 'compulsory' },
    { name: 'consignee_name', admissibility: 'compulsory' },
    { name: 'delivery_date', admissibility: 'compulsory' },
    { name: 'delivery_note_reference', admissibility: 'compulsory' },
    { name: 'line_items', admissibility: 'compulsory' },
    { name: 'purchase_order_reference', admissibility: 'optional' },
    { name: 'freight_invoice_reference', admissibility: 'optional' },
  ],

  CUSTOMS_DECLARATION: [
    { name: 'importer_name', admissibility: 'compulsory' },
    { name: 'commodity_code', admissibility: 'compulsory' },
    { name: 'commodity_description', admissibility: 'compulsory' },
    { name: 'country_of_origin', admissibility: 'compulsory' },
    { name: 'country_of_dispatch', admissibility: 'compulsory' },
    { name: 'declared_weight', admissibility: 'compulsory' },
    { name: 'weight_unit', admissibility: 'compulsory' },
    { name: 'declaration_reference', admissibility: 'compulsory' },
    { name: 'declaration_date', admissibility: 'compulsory' },
    { name: 'customs_procedure', admissibility: 'optional' },
    { name: 'declared_value', admissibility: 'optional' },
    {
      name: 'currency',
      admissibility: 'conditional',
      condition: 'declared_value is present',
      conditionFn: (f) => f['declared_value'] !== null,
    },
  ],

  BILL_OF_LADING: [
    { name: 'shipper_name', admissibility: 'compulsory' },
    { name: 'consignee_name', admissibility: 'compulsory' },
    { name: 'port_of_loading', admissibility: 'compulsory' },
    { name: 'port_of_discharge', admissibility: 'compulsory' },
    { name: 'commodity_description', admissibility: 'compulsory' },
    { name: 'gross_weight', admissibility: 'compulsory' },
    { name: 'gross_weight_unit', admissibility: 'compulsory' },
    { name: 'bill_of_lading_number', admissibility: 'compulsory' },
    { name: 'date_of_issue', admissibility: 'compulsory' },
    { name: 'vessel_name', admissibility: 'optional' },
    { name: 'container_numbers', admissibility: 'optional' },
  ],

  SUPPLIER_INVOICE: [
    { name: 'supplier_name', admissibility: 'compulsory' },
    { name: 'buyer_name', admissibility: 'compulsory' },
    { name: 'invoice_number', admissibility: 'compulsory' },
    { name: 'invoice_date', admissibility: 'compulsory' },
    { name: 'line_items', admissibility: 'compulsory' },
    { name: 'currency', admissibility: 'compulsory' },
    { name: 'total_value', admissibility: 'compulsory' },
    { name: 'supplier_registration_number', admissibility: 'optional' },
    { name: 'purchase_order_reference', admissibility: 'optional' },
  ],

  PURCHASE_ORDER: [
    { name: 'buyer_name', admissibility: 'compulsory' },
    { name: 'supplier_name', admissibility: 'compulsory' },
    { name: 'po_number', admissibility: 'compulsory' },
    { name: 'po_date', admissibility: 'compulsory' },
    { name: 'line_items', admissibility: 'compulsory' },
    { name: 'currency', admissibility: 'compulsory' },
    { name: 'delivery_due_date', admissibility: 'optional' },
  ],

  SUPPLIER_QUESTIONNAIRE: [
    { name: 'supplier_name', admissibility: 'compulsory' },
    { name: 'responding_entity', admissibility: 'compulsory' },
    { name: 'reporting_period_start', admissibility: 'compulsory' },
    { name: 'reporting_period_end', admissibility: 'compulsory' },
    { name: 'response_completeness', admissibility: 'compulsory' },
    { name: 'methodology_stated', admissibility: 'compulsory' },
    // Always Tier B regardless of completeness — no document backing
  ],

  ENVIRONMENTAL_CERTIFICATE: [
    { name: 'certificate_holder_name', admissibility: 'compulsory' },
    { name: 'standard', admissibility: 'compulsory' },
    { name: 'issuing_body', admissibility: 'compulsory' },
    { name: 'accreditation_body', admissibility: 'compulsory' },
    { name: 'certificate_number', admissibility: 'compulsory' },
    { name: 'scope', admissibility: 'compulsory' },
    { name: 'issue_date', admissibility: 'compulsory' },
    { name: 'expiry_date', admissibility: 'compulsory' },
  ],

  CBAM_DECLARATION: [
    { name: 'declarant_name', admissibility: 'compulsory' },
    { name: 'commodity_code', admissibility: 'compulsory' },
    { name: 'commodity_description', admissibility: 'compulsory' },
    { name: 'country_of_origin', admissibility: 'compulsory' },
    { name: 'production_period_start', admissibility: 'compulsory' },
    { name: 'production_period_end', admissibility: 'compulsory' },
    { name: 'quantity_tonnes', admissibility: 'compulsory' },
    { name: 'embedded_emissions_tco2e', admissibility: 'compulsory' },
    { name: 'embedded_emissions_per_tonne', admissibility: 'compulsory' },
    { name: 'calculation_tier', admissibility: 'compulsory' },
    { name: 'calculation_methodology', admissibility: 'compulsory' },
    {
      name: 'supporting_data_reference',
      admissibility: 'conditional',
      condition: 'calculation_tier is TIER_1 or TIER_2',
      conditionFn: (f) =>
        f['calculation_tier'] === 'TIER_1' || f['calculation_tier'] === 'TIER_2',
    },
  ],

  WASTE_RECORD: [
    { name: 'entity_name', admissibility: 'compulsory' },
    { name: 'site_name', admissibility: 'compulsory' },
    { name: 'waste_type', admissibility: 'compulsory' },
    { name: 'waste_classification', admissibility: 'compulsory' },
    { name: 'quantity', admissibility: 'compulsory' },
    { name: 'unit', admissibility: 'compulsory' },
    { name: 'disposal_method', admissibility: 'compulsory' },
    { name: 'contractor_name', admissibility: 'compulsory' },
    { name: 'contractor_licence', admissibility: 'compulsory' },
    { name: 'period_start', admissibility: 'compulsory' },
    { name: 'period_end', admissibility: 'compulsory' },
    { name: 'record_reference', admissibility: 'compulsory' },
  ],

  WATER_RECORD: [
    { name: 'entity_name', admissibility: 'compulsory' },
    { name: 'site_name', admissibility: 'compulsory' },
    { name: 'water_source_type', admissibility: 'compulsory' },
    { name: 'quantity_m3', admissibility: 'compulsory' },
    { name: 'period_start', admissibility: 'compulsory' },
    { name: 'period_end', admissibility: 'compulsory' },
    { name: 'meter_reference', admissibility: 'optional' },
    { name: 'record_reference', admissibility: 'optional' },
  ],

  CROP_YIELD_RECORD: [
    { name: 'entity_name', admissibility: 'compulsory' },
    { name: 'site_or_field_id', admissibility: 'compulsory' },
    { name: 'crop_type', admissibility: 'compulsory' },
    { name: 'crop_variety', admissibility: 'optional' },
    { name: 'area_hectares', admissibility: 'compulsory' },
    { name: 'yield_quantity', admissibility: 'compulsory' },
    { name: 'yield_unit', admissibility: 'compulsory' },
    { name: 'harvest_date', admissibility: 'compulsory' },
    { name: 'season', admissibility: 'optional' },
    { name: 'certification_reference', admissibility: 'optional' },
  ],

  FERTILISER_RECORD: [
    { name: 'entity_name', admissibility: 'compulsory' },
    { name: 'site_or_field_id', admissibility: 'compulsory' },
    { name: 'product_name', admissibility: 'compulsory' },
    { name: 'nitrogen_content_percent', admissibility: 'compulsory' },
    { name: 'phosphorus_content_percent', admissibility: 'conditional', condition: 'product is an NPK fertiliser' },
    { name: 'potassium_content_percent', admissibility: 'conditional', condition: 'product is an NPK fertiliser' },
    { name: 'quantity_applied_per_hectare', admissibility: 'compulsory' },
    { name: 'application_rate_unit', admissibility: 'compulsory' },
    { name: 'total_quantity_applied', admissibility: 'compulsory' },
    { name: 'total_unit', admissibility: 'compulsory' },
    { name: 'application_date', admissibility: 'compulsory' },
    { name: 'application_method', admissibility: 'optional' },
  ],

  LIVESTOCK_RECORD: [
    { name: 'entity_name', admissibility: 'compulsory' },
    { name: 'site_name', admissibility: 'compulsory' },
    { name: 'species', admissibility: 'compulsory' },
    { name: 'breed', admissibility: 'optional' },
    { name: 'average_herd_size', admissibility: 'compulsory' },
    { name: 'period_start', admissibility: 'compulsory' },
    { name: 'period_end', admissibility: 'compulsory' },
    { name: 'feed_type', admissibility: 'optional' },
    { name: 'feed_quantity', admissibility: 'optional' },
    {
      name: 'feed_unit',
      admissibility: 'conditional',
      condition: 'feed_quantity is present',
      conditionFn: (f) => f['feed_quantity'] !== null,
    },
    { name: 'record_reference', admissibility: 'optional' },
  ],

  PRODUCT_CERTIFICATE: [
    { name: 'certificate_holder_name', admissibility: 'compulsory' },
    { name: 'certificate_type', admissibility: 'compulsory' },
    { name: 'issuing_body', admissibility: 'compulsory' },
    { name: 'certificate_number', admissibility: 'compulsory' },
    { name: 'scope_of_certification', admissibility: 'compulsory' },
    { name: 'issue_date', admissibility: 'compulsory' },
    { name: 'expiry_date', admissibility: 'compulsory' },
    { name: 'audit_or_verification_date', admissibility: 'optional' },
  ],

  CHAIN_OF_CUSTODY: [
    { name: 'document_reference', admissibility: 'compulsory' },
    { name: 'product_type', admissibility: 'compulsory' },
    { name: 'custody_stages', admissibility: 'compulsory' },
    { name: 'origin_entity', admissibility: 'compulsory' },
    { name: 'final_entity', admissibility: 'compulsory' },
    { name: 'certification_standard', admissibility: 'compulsory' },
  ],
}
```

### Admissibility enforcement

`src/lib/extraction/admissibility.ts`:

```typescript
import { TrustTier, FlagType, Severity } from '@prisma/client'
import { DOCUMENT_FIELD_DEFINITIONS } from './field-definitions'
import type { ExtractedFieldResult } from './types'

export interface AdmissibilityFlag {
  fieldName: string
  flagType: FlagType
  message: string
  severity: Severity
}

export interface AdmissibilityResult {
  tier: TrustTier
  flags: AdmissibilityFlag[]
  criticalCount: number
}

export function evaluateAdmissibility(
  documentType: string,
  extractedFields: ExtractedFieldResult[],
  entityName: string,
  reportingPeriodEnd?: Date,
): AdmissibilityResult {
  const fieldDefs = DOCUMENT_FIELD_DEFINITIONS[documentType] ?? []
  const flags: AdmissibilityFlag[] = []

  const fieldValues: Record<string, string | null> = {}
  for (const f of extractedFields) {
    fieldValues[f.fieldName] = f.rawValue ?? null
  }

  // Check compulsory fields
  for (const def of fieldDefs) {
    const extracted = extractedFields.find(f => f.fieldName === def.name)

    if (def.admissibility === 'compulsory') {
      if (!extracted || extracted.rawValue === null || extracted.rawValue === '') {
        flags.push({
          fieldName: def.name,
          flagType: FlagType.COMPLETENESS_GAP,
          message: `Compulsory field '${def.name}' is absent. Document cannot achieve Tier A.`,
          severity: Severity.CRITICAL,
        })
      }
    }

    if (def.admissibility === 'conditional' && def.conditionFn) {
      if (def.conditionFn(fieldValues)) {
        if (!extracted || extracted.rawValue === null || extracted.rawValue === '') {
          flags.push({
            fieldName: def.name,
            flagType: FlagType.MISSING_CONDITIONAL_FIELD,
            message: `Conditional field '${def.name}' required when: ${def.condition}. Field absent.`,
            severity: Severity.WARNING,
          })
        }
      }
    }
  }

  // Low confidence
  for (const f of extractedFields) {
    if (f.confidenceScore < 0.85 && f.rawValue !== null) {
      flags.push({
        fieldName: f.fieldName,
        flagType: FlagType.LOW_CONFIDENCE,
        message: `Confidence ${f.confidenceScore.toFixed(2)} below 0.85 threshold for '${f.fieldName}'.`,
        severity: Severity.WARNING,
      })
    }
  }

  // Estimated read (electricity/gas)
  if (documentType === 'ELECTRICITY_BILL' || documentType === 'GAS_BILL') {
    if (fieldValues['read_type'] === 'ESTIMATED') {
      flags.push({
        fieldName: 'read_type',
        flagType: FlagType.COMPLETENESS_GAP,
        message: 'Meter read is ESTIMATED. Record is Tier B. Submit an ACTUAL read for the same period to upgrade.',
        severity: Severity.CRITICAL,
      })
    }
  }

  // 8-digit commodity code required
  if (documentType === 'CUSTOMS_DECLARATION' || documentType === 'CBAM_DECLARATION') {
    const code = fieldValues['commodity_code']
    if (code && code.replace(/\s/g, '').length < 8) {
      flags.push({
        fieldName: 'commodity_code',
        flagType: FlagType.CODE_INSUFFICIENT,
        message: `Commodity code '${code}' has ${code.replace(/\s/g, '').length} digits. 8-digit CN code required for CBAM.`,
        severity: Severity.CRITICAL,
      })
    }
  }

  // Generic fuel type
  if (documentType === 'FUEL_RECEIPT') {
    if (fieldValues['fuel_type'] === 'OTHER' && !fieldValues['fuel_type_description']) {
      flags.push({
        fieldName: 'fuel_type',
        flagType: FlagType.GENERIC_VALUE,
        message: "fuel_type is OTHER but no description provided. Generic 'fuel' is not admissible at Tier A.",
        severity: Severity.CRITICAL,
      })
    }
  }

  // Certificate expiry
  if (['PRODUCT_CERTIFICATE', 'ENVIRONMENTAL_CERTIFICATE', 'RENEWABLE_CERTIFICATE'].includes(documentType)) {
    const expiryStr = fieldValues['expiry_date']
    if (expiryStr && reportingPeriodEnd) {
      if (new Date(expiryStr) < reportingPeriodEnd) {
        flags.push({
          fieldName: 'expiry_date',
          flagType: FlagType.EXPIRED_CERTIFICATE,
          message: `Certificate expired ${expiryStr}, before reporting period end. Invalid for this period.`,
          severity: Severity.CRITICAL,
        })
      }
    }
  }

  // Entity match
  const nameFields = ['entity_name', 'account_holder_name', 'certificate_holder_name',
                      'declarant_name', 'importer_name', 'purchaser_name']
  for (const nameField of nameFields) {
    const val = fieldValues[nameField]
    if (val && entityName) {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!norm(val).includes(norm(entityName)) && !norm(entityName).includes(norm(val))) {
        flags.push({
          fieldName: nameField,
          flagType: FlagType.ENTITY_MISMATCH,
          message: `'${nameField}' value '${val}' does not match registered entity '${entityName}'.`,
          severity: Severity.WARNING,
        })
      }
    }
  }

  // CBAM Tier 1/2 requires supporting data reference
  if (documentType === 'CBAM_DECLARATION') {
    const tier = fieldValues['calculation_tier']
    const ref = fieldValues['supporting_data_reference']
    if ((tier === 'TIER_1' || tier === 'TIER_2') && (!ref || ref === '')) {
      flags.push({
        fieldName: 'supporting_data_reference',
        flagType: FlagType.COMPLETENESS_GAP,
        message: `CBAM ${tier} declaration requires supporting_data_reference. Embedded figure unverifiable without it.`,
        severity: Severity.CRITICAL,
      })
    }
  }

  const criticalCount = flags.filter(f => f.severity === Severity.CRITICAL).length
  const tier: TrustTier = documentType === 'SUPPLIER_QUESTIONNAIRE' || criticalCount > 0
    ? TrustTier.B
    : TrustTier.A

  return { tier, flags, criticalCount }
}
```

**Acceptance test:** All admissibility unit tests pass — ACTUAL read → Tier A, ESTIMATED read → Tier B, 6-digit CN code → CRITICAL, missing compulsory field → Tier B, CBAM Tier 1 without reference → CRITICAL, SUPPLIER_QUESTIONNAIRE always → Tier B.

---

## Sprint 1.6 — Job Queue (Inngest)

Claude API calls take 5–30 seconds. Document extraction must be async with retries.

`src/inngest/client.ts`:

```typescript
import { Inngest } from 'inngest'
export const inngest = new Inngest({ id: 'arbor' })
```

`src/inngest/functions/extract-document.ts`:

```typescript
import { inngest } from '@/inngest/client'
import { prisma } from '@/lib/prisma'
import { extractDocument } from '@/lib/extraction/engine'
import { evaluateAdmissibility } from '@/lib/extraction/admissibility'
import { fetchDocumentAsBase64 } from '@/lib/storage-retrieval'
import { sendNotification } from '@/lib/notifications'
import { DOCUMENT_FIELD_DEFINITIONS } from '@/lib/extraction/field-definitions'

export const extractDocumentFunction = inngest.createFunction(
  { id: 'extract-document', retries: 2, concurrency: { limit: 5 } },
  { event: 'document/uploaded' },
  async ({ event, step }) => {
    const { documentId, entityId, entityName, documentType, reportingPeriodEnd } = event.data

    const job = await step.run('create-extraction-job', async () => {
      await prisma.document.update({ where: { id: documentId }, data: { status: 'EXTRACTING' } })
      return prisma.extractionJob.create({
        data: { documentId, status: 'RUNNING', startedAt: new Date() },
      })
    })

    const { base64, mediaType } = await step.run('fetch-document', async () => {
      const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } })
      return fetchDocumentAsBase64(doc.blobUrl)
    })

    const extractionResult = await step.run('run-extraction', async () => {
      return extractDocument({ documentBase64: base64, mediaType, documentType, entityName })
    })

    if (!extractionResult.success) {
      await step.run('mark-failed', async () => {
        await prisma.extractionJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', completedAt: new Date(), errorMessage: extractionResult.extractionNotes },
        })
        await prisma.document.update({ where: { id: documentId }, data: { status: 'REJECTED' } })
      })
      return { success: false }
    }

    const admissibility = evaluateAdmissibility(
      documentType,
      extractionResult.fields,
      entityName,
      reportingPeriodEnd ? new Date(reportingPeriodEnd) : undefined,
    )

    await step.run('store-extracted-fields', async () => {
      const defs = DOCUMENT_FIELD_DEFINITIONS[documentType] ?? []
      await prisma.extractionJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETE',
          completedAt: new Date(),
          rawOutput: extractionResult as any,
          extractedFields: {
            create: extractionResult.fields.map(f => {
              const def = defs.find(d => d.name === f.fieldName)
              return {
                fieldName: f.fieldName,
                admissibility: def?.admissibility === 'compulsory' ? 'COMPULSORY'
                             : def?.admissibility === 'conditional' ? 'CONDITIONAL'
                             : 'OPTIONAL',
                rawValue: f.rawValue,
                rawUnit: f.rawUnit,
                sourceText: f.sourceText,
                confidenceScore: f.confidenceScore,
                flagged: f.flagged,
                flagReason: f.flagReason,
              }
            }),
          },
        },
      })
      await prisma.document.update({ where: { id: documentId }, data: { status: 'REVIEW_REQUIRED' } })
    })

    await step.run('send-notification', async () => {
      await sendNotification({
        entityId,
        type: 'EXTRACTION_COMPLETE',
        payload: {
          documentId,
          documentType,
          tier: admissibility.tier,
          flagCount: admissibility.flags.length,
          criticalCount: admissibility.criticalCount,
        },
      })
    })

    return { success: true, jobId: job.id, tier: admissibility.tier }
  }
)
```

`src/app/api/inngest/route.ts`:

```typescript
import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { extractDocumentFunction } from '@/inngest/functions/extract-document'

export const { GET, POST, PUT } = serve({ client: inngest, functions: [extractDocumentFunction] })
```

**Acceptance test:** Upload a document via the API. Confirm Inngest fires the event. Confirm `ExtractionJob` moves from RUNNING to COMPLETE. Confirm `ExtractedField` records exist.

---

## Sprint 1.7 — Document Extraction Engine (Layer 1)

`src/lib/extraction/types.ts`:

```typescript
export interface ExtractionInput {
  documentBase64: string
  mediaType: 'application/pdf' | 'image/jpeg' | 'image/png'
  documentType: string
  entityName: string
}

export interface ExtractedFieldResult {
  fieldName: string
  rawValue: string | null
  rawUnit: string | null
  sourceText: string
  confidenceScore: number
  flagged: boolean
  flagReason: string | null
}

export interface ExtractionResult {
  success: boolean
  fields: ExtractedFieldResult[]
  documentTypeConfirmed: string
  extractionNotes: string
  rawResponse: string
}
```

`src/lib/extraction/prompts.ts`:

```typescript
export const EXTRACTION_SYSTEM_PROMPT = `
You are a document data extraction engine for a sustainability data infrastructure platform.

Extract only what is present in the document. Never infer, estimate, or fabricate values.

Return ONLY valid JSON. No preamble. No markdown fences. No explanation.

For every field:
- rawValue: value exactly as in the document, or null if not found
- rawUnit: unit exactly as in the document, or null
- sourceText: exact verbatim text from the document containing this value
- confidenceScore: 0.0–1.0 (1.0=unambiguous, 0.9=clear but minor interpretation, 0.7=could be misread, 0.5=inferred, <0.5=set flagged true)
- flagged: true if confidenceScore < 0.85 or uncertain
- flagReason: brief explanation if flagged, null otherwise

If a field is not present: rawValue=null, confidenceScore=0.0, flagged=true, flagReason="Field not found in document".
`

export function buildExtractionPrompt(documentType: string, requiredFields: string[]): string {
  return `Extract the following fields from this ${documentType.replace(/_/g, ' ').toLowerCase()}.

Required fields: ${requiredFields.join(', ')}

Return this exact JSON structure with no other text:
{
  "documentTypeConfirmed": "your assessment of document type",
  "extractionNotes": "observations about quality or unusual features",
  "fields": [
    {
      "fieldName": "field_name_here",
      "rawValue": "value as written or null",
      "rawUnit": "unit as written or null",
      "sourceText": "exact verbatim text from document",
      "confidenceScore": 0.95,
      "flagged": false,
      "flagReason": null
    }
  ]
}`
}
```

`src/lib/extraction/engine.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages'
import { ExtractionInput, ExtractionResult } from './types'
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionPrompt } from './prompts'
import { DOCUMENT_FIELD_DEFINITIONS } from './field-definitions'

const client = new Anthropic()

export async function extractDocument(input: ExtractionInput): Promise<ExtractionResult> {
  const fieldDefs = DOCUMENT_FIELD_DEFINITIONS[input.documentType] ?? []
  const requiredFields = fieldDefs.map(f => f.name)
  const userPrompt = buildExtractionPrompt(input.documentType, requiredFields)

  // PDFs use type:'document', images use type:'image' — these are distinct API content block types
  const documentBlock: ContentBlockParam =
    input.mediaType === 'application/pdf'
      ? {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: input.documentBase64 },
        }
      : {
          type: 'image',
          source: { type: 'base64', media_type: input.mediaType, data: input.documentBase64 },
        }

  const messages: MessageParam[] = [
    { role: 'user', content: [documentBlock, { type: 'text', text: userPrompt }] },
  ]

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: EXTRACTION_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },  // prompt caching — same system prompt every call
      },
    ],
    messages,
  })

  const rawText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('')

  try {
    const parsed = JSON.parse(rawText)
    return {
      success: true,
      fields: parsed.fields ?? [],
      documentTypeConfirmed: parsed.documentTypeConfirmed ?? input.documentType,
      extractionNotes: parsed.extractionNotes ?? '',
      rawResponse: rawText,
    }
  } catch {
    return {
      success: false,
      fields: [],
      documentTypeConfirmed: input.documentType,
      extractionNotes: 'Extraction failed — could not parse Claude response as JSON',
      rawResponse: rawText,
    }
  }
}
```

**Acceptance test:** Mocked Anthropic client returns a valid JSON response. Test confirms `ExtractionResult` has fields, confidenceScores, and sourceText populated. Test confirms `type:'image'` is used for JPEG, `type:'document'` for PDF. Test confirms `success:false` on invalid JSON response.

---

## Sprint 1.8 — Calculation Engine (Layer 2)

Layer 2 is pure functions only. No DB reads. No API calls. No side effects. Same inputs always return same outputs.

`src/lib/calculation/unit-conversion.ts`:

```typescript
// Layer 2 — Unit Conversion
// GHG Protocol Scope 3 Standard Ch.7 — unit consistency
// DEFRA Conversion Factors 2024 — UK reporting basis

export function kwhToMj(kwh: number): number {
  return kwh * 3.6  // 1 kWh = 3.6 MJ (exact, SI definition)
}

export function thermsToMj(therms: number): number {
  return therms * 105.505585  // 1 therm (UK) = 105.505585 MJ
}

export function tonnesToKg(tonnes: number): number {
  return tonnes * 1000  // 1 tonne = 1000 kg (exact)
}

export function shortTonsToKg(shortTons: number): number {
  return shortTons * 907.18474  // 1 short ton (US) = 907.18474 kg
}

export function litresToM3(litres: number): number {
  return litres * 0.001  // 1 litre = 0.001 m³ (exact)
}

export function hectaresToM2(hectares: number): number {
  return hectares * 10000  // 1 hectare = 10,000 m² (exact)
}

export function milesToKm(miles: number): number {
  return miles * 1.609344  // 1 mile = 1.609344 km (exact, international definition)
}

export type SupportedUnit =
  | 'kwh' | 'mj' | 'gj' | 'therms' | 'toe'
  | 'kg' | 'tonnes' | 'short_tons' | 'lbs'
  | 'litres' | 'm3' | 'gallons_uk' | 'gallons_us'
  | 'm2' | 'hectares' | 'acres'
  | 'km' | 'miles' | 'nautical_miles'
  | 'kg_co2e' | 'tonnes_co2e'

export function normaliseToSI(value: number, unit: SupportedUnit): { value: number; siUnit: string } {
  switch (unit) {
    case 'kwh':           return { value: kwhToMj(value), siUnit: 'mj' }
    case 'mj':            return { value, siUnit: 'mj' }
    case 'gj':            return { value: value * 1000, siUnit: 'mj' }
    case 'therms':        return { value: thermsToMj(value), siUnit: 'mj' }
    case 'toe':           return { value: value * 41868, siUnit: 'mj' }
    case 'kg':            return { value, siUnit: 'kg' }
    case 'tonnes':        return { value: tonnesToKg(value), siUnit: 'kg' }
    case 'short_tons':    return { value: shortTonsToKg(value), siUnit: 'kg' }
    case 'lbs':           return { value: value * 0.453592, siUnit: 'kg' }
    case 'litres':        return { value: litresToM3(value), siUnit: 'm3' }
    case 'm3':            return { value, siUnit: 'm3' }
    case 'gallons_uk':    return { value: value * 0.00454609, siUnit: 'm3' }
    case 'gallons_us':    return { value: value * 0.00378541, siUnit: 'm3' }
    case 'm2':            return { value, siUnit: 'm2' }
    case 'hectares':      return { value: hectaresToM2(value), siUnit: 'm2' }
    case 'acres':         return { value: value * 4046.86, siUnit: 'm2' }
    case 'km':            return { value, siUnit: 'km' }
    case 'miles':         return { value: milesToKm(value), siUnit: 'km' }
    case 'nautical_miles': return { value: value * 1.852, siUnit: 'km' }
    case 'kg_co2e':       return { value, siUnit: 'kg_co2e' }
    case 'tonnes_co2e':   return { value: value * 1000, siUnit: 'kg_co2e' }
    default:              return { value, siUnit: unit }
  }
}
```

`src/lib/calculation/emission-factors.ts`:

```typescript
// Layer 2 — Emission Factor Application
// GHG Protocol Corporate Standard Ch.4 — Activity data × emission factor
// Pure function: no DB reads, no API calls, no side effects.

export interface EmissionFactorInput {
  activityValue: number
  activityUnit: string
  factor: number
  factorUnit: string
  factorSource: string
  factorVersion: string
  citation: string
}

export interface EmissionCalculationResult {
  co2eKg: number
  activityValue: number
  activityUnit: string
  factor: number
  factorUnit: string
  factorSource: string
  factorVersion: string
  citation: string
  calculationExpression: string
}

export function applyEmissionFactor(input: EmissionFactorInput): EmissionCalculationResult {
  const co2eKg = input.activityValue * input.factor
  return {
    co2eKg,
    activityValue: input.activityValue,
    activityUnit: input.activityUnit,
    factor: input.factor,
    factorUnit: input.factorUnit,
    factorSource: input.factorSource,
    factorVersion: input.factorVersion,
    citation: input.citation,
    calculationExpression:
      `${input.activityValue} ${input.activityUnit} × ${input.factor} ${input.factorUnit} = ${co2eKg.toFixed(4)} kg CO2e`,
  }
}
```

`src/lib/calculation/embedded-emissions.ts`:

```typescript
// Layer 2 — Embedded Emissions Calculation
// EU Regulation 2023/1773 Art. 4(1)(2) — total and specific embedded emissions
// GHG Protocol Product Standard — product-level embedded emissions methodology

export interface EmbeddedEmissionsInput {
  directEmissionsKgCo2e: number
  indirectEmissionsKgCo2e: number
  productMassKg: number
  tier: 1 | 2 | 3
}

export interface EmbeddedEmissionsResult {
  totalEmbeddedEmissionsKgCo2e: number
  embeddedEmissionsPerTonneKgCo2e: number
  directEmissionsKgCo2e: number
  indirectEmissionsKgCo2e: number
  productMassKg: number
  tier: 1 | 2 | 3
  citation: string
}

export function calculateEmbeddedEmissions(input: EmbeddedEmissionsInput): EmbeddedEmissionsResult {
  if (input.productMassKg <= 0) throw new Error('Product mass must be greater than zero')
  if (input.directEmissionsKgCo2e < 0) throw new Error('Direct emissions cannot be negative')
  if (input.indirectEmissionsKgCo2e < 0) throw new Error('Indirect emissions cannot be negative')

  // EU 2023/1773 Art. 4(1) — total embedded = direct + indirect
  const total = input.directEmissionsKgCo2e + input.indirectEmissionsKgCo2e

  // EU 2023/1773 Art. 4(2) — specific embedded = total / mass × 1000 (per tonne)
  const perTonne = (total / input.productMassKg) * 1000

  return {
    totalEmbeddedEmissionsKgCo2e: total,
    embeddedEmissionsPerTonneKgCo2e: perTonne,
    directEmissionsKgCo2e: input.directEmissionsKgCo2e,
    indirectEmissionsKgCo2e: input.indirectEmissionsKgCo2e,
    productMassKg: input.productMassKg,
    tier: input.tier,
    citation: 'EU Regulation 2023/1773 Art. 4(1)(2) — Specific embedded emissions per tonne of product',
  }
}
```

`src/lib/calculation/audit-chain.ts`:

```typescript
import { createHmac } from 'crypto'

const HMAC_SECRET = process.env.AUDIT_CHAIN_SECRET
if (!HMAC_SECRET) throw new Error('AUDIT_CHAIN_SECRET environment variable is not set')

export interface AuditPayload {
  recordId: string
  entityId: string
  domain: string
  fieldName: string
  value: number
  unit: string
  trustTier: string
  submittedAt: string
  submittedById: string
}

export function computeRecordHash(payload: AuditPayload, previousHash: string | null): string {
  const input = JSON.stringify({ ...payload, previousHash: previousHash ?? 'GENESIS' })
  return createHmac('sha256', HMAC_SECRET!).update(input).digest('hex')
}

export function verifyChain(
  entries: Array<{ hash: string; previousHash: string | null; payload: AuditPayload }>
): boolean {
  for (let i = 0; i < entries.length; i++) {
    const expected = computeRecordHash(entries[i].payload, entries[i].previousHash)
    if (expected !== entries[i].hash) return false
    if (i > 0 && entries[i].previousHash !== entries[i - 1].hash) return false
  }
  return true
}
```

**Acceptance test:** Unit tests with known inputs verify exact numeric outputs. `@regulatory` tests include EU 2023/1773 citations. `verifyChain` passes a valid chain, fails on a tampered entry. `npx tsc --noEmit` exits 0 on all calculation files.

---

## Sprint 1.9 — Cross-Validation Engine

`src/lib/validation/cross-validation.ts`:

```typescript
// PRD Section 9.3 — Cross-validation rules
// crossValidate is Layer 2 (pure function). runCrossValidation is Layer 1 (reads DB).

import { prisma } from '@/lib/prisma'

export interface CrossValidationInput {
  entityId: string
  documentAId: string
  documentBId: string
  fieldName: string
  valueA: number
  valueB: number
  tolerancePercent: number
}

export interface CrossValidationOutput {
  passed: boolean
  discrepancyPercent: number
  message: string
}

export function crossValidate(input: CrossValidationInput): CrossValidationOutput {
  if (input.valueA === 0 && input.valueB === 0) {
    return { passed: true, discrepancyPercent: 0, message: 'Both values are zero — consistent.' }
  }

  const reference = Math.max(Math.abs(input.valueA), Math.abs(input.valueB))
  const discrepancyPercent = reference === 0 ? 0
    : (Math.abs(input.valueA - input.valueB) / reference) * 100
  const passed = discrepancyPercent <= input.tolerancePercent

  return {
    passed,
    discrepancyPercent,
    message: passed
      ? `Values consistent within ${input.tolerancePercent}% tolerance (${discrepancyPercent.toFixed(2)}% discrepancy).`
      : `Discrepancy of ${discrepancyPercent.toFixed(2)}% exceeds ${input.tolerancePercent}% tolerance. A: ${input.valueA}, B: ${input.valueB}.`,
  }
}

export const CROSS_VALIDATION_RULES = [
  { docTypeA: 'FREIGHT_INVOICE', docTypeB: 'DELIVERY_NOTE', fieldA: 'shipment_weight', fieldB: 'total_quantity', tolerancePercent: 2, description: 'Freight invoice weight vs delivery note quantity' },
  { docTypeA: 'FREIGHT_INVOICE', docTypeB: 'CUSTOMS_DECLARATION', fieldA: 'shipment_weight', fieldB: 'declared_weight', tolerancePercent: 2, description: 'Freight invoice weight vs customs declared weight' },
  { docTypeA: 'SUPPLIER_INVOICE', docTypeB: 'DELIVERY_NOTE', fieldA: 'total_quantity', fieldB: 'total_quantity', tolerancePercent: 1, description: 'Invoice quantity vs delivery note quantity' },
  { docTypeA: 'SUPPLIER_INVOICE', docTypeB: 'PURCHASE_ORDER', fieldA: 'total_quantity', fieldB: 'total_quantity', tolerancePercent: 5, description: 'Invoice quantity vs PO quantity' },
  { docTypeA: 'ELECTRICITY_BILL', docTypeB: 'RENEWABLE_CERTIFICATE', fieldA: 'total_consumption_kwh', fieldB: 'quantity_mwh_in_kwh', tolerancePercent: 0, description: 'REGO quantity must not exceed metered consumption' },
]

export async function runCrossValidation(
  entityId: string,
  newDocumentId: string,
  newDocumentType: string,
): Promise<void> {
  const applicable = CROSS_VALIDATION_RULES.filter(
    r => r.docTypeA === newDocumentType || r.docTypeB === newDocumentType
  )

  for (const rule of applicable) {
    const counterpartType = rule.docTypeA === newDocumentType ? rule.docTypeB : rule.docTypeA
    const counterpartField = rule.docTypeA === newDocumentType ? rule.fieldB : rule.fieldA
    const thisField = rule.docTypeA === newDocumentType ? rule.fieldA : rule.fieldB

    const counterpartDocs = await prisma.document.findMany({
      where: { entityId, documentType: counterpartType as any, status: 'ACCEPTED' },
      include: { dataRecords: { where: { fieldName: counterpartField, isActive: true } } },
    })

    const thisDoc = await prisma.document.findUnique({
      where: { id: newDocumentId },
      include: { dataRecords: { where: { fieldName: thisField, isActive: true } } },
    })

    if (!thisDoc || thisDoc.dataRecords.length === 0) continue

    for (const counterpart of counterpartDocs) {
      for (const recordB of counterpart.dataRecords) {
        for (const recordA of thisDoc.dataRecords) {
          const result = crossValidate({
            entityId, documentAId: newDocumentId, documentBId: counterpart.id,
            fieldName: thisField, valueA: recordA.value, valueB: recordB.value,
            tolerancePercent: rule.tolerancePercent,
          })

          await prisma.crossValidationResult.create({
            data: {
              entityId, documentAId: newDocumentId, documentBId: counterpart.id,
              fieldName: thisField, valueA: recordA.value, valueB: recordB.value,
              tolerancePercent: rule.tolerancePercent,
              discrepancyPercent: result.discrepancyPercent, passed: result.passed,
            },
          })

          if (!result.passed) {
            await prisma.validationFlag.createMany({
              data: [
                { dataRecordId: recordA.id, flagType: 'CROSS_DOC_DISCREPANCY', message: result.message, severity: 'WARNING' },
                { dataRecordId: recordB.id, flagType: 'CROSS_DOC_DISCREPANCY', message: result.message, severity: 'WARNING' },
              ],
            })
          }
        }
      }
    }
  }
}
```

**Acceptance test:** `crossValidate` passes within tolerance, fails beyond tolerance, both-zero passes. `runCrossValidation` creates `CrossValidationResult` records and raises `ValidationFlag` records on discrepancies.

---

## Sprint 1.10 — Notifications

`src/lib/notifications.ts`:

```typescript
import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'
import { NotificationType } from '@prisma/client'

const resend = new Resend(process.env.RESEND_API_KEY)

interface NotificationInput {
  entityId: string
  type: NotificationType
  payload: Record<string, unknown>
}

export async function sendNotification(input: NotificationInput): Promise<void> {
  await prisma.notification.create({
    data: { entityId: input.entityId, type: input.type, payload: input.payload },
  })

  const users = await prisma.user.findMany({
    where: { entityId: input.entityId },
    select: { email: true, name: true },
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const subject = notificationSubject(input.type, input.payload)
  const html = notificationHtml(input.type, input.payload, appUrl ?? '')

  await Promise.allSettled(
    users.map(u => resend.emails.send({ from: 'Arbor <no-reply@arbor.io>', to: u.email, subject, html }))
  )
}

function notificationSubject(type: NotificationType, payload: Record<string, unknown>): string {
  switch (type) {
    case 'DATA_REQUEST_RECEIVED': return `Data request from ${payload.buyerName}`
    case 'EXTRACTION_COMPLETE': return `Extraction complete — ${payload.documentType}`
    case 'FLAG_RAISED': return `Validation flag raised on your data`
    case 'TIER_UPGRADED': return `Data record upgraded to Tier A`
    default: return `Arbor notification`
  }
}

function notificationHtml(type: NotificationType, payload: Record<string, unknown>, appUrl: string): string {
  switch (type) {
    case 'DATA_REQUEST_RECEIVED':
      return `<p>Data request from <strong>${payload.buyerName}</strong>.<br>Domain: ${payload.domain} | Period: ${payload.periodStart} – ${payload.periodEnd}<br><a href="${appUrl}/requests/${payload.requestId}">View request</a></p>`
    case 'EXTRACTION_COMPLETE':
      return `<p>Extraction complete for <strong>${payload.documentType}</strong>.<br>Trust tier: <strong>${payload.tier}</strong> | Flags: ${payload.flagCount} (${payload.criticalCount} critical)<br><a href="${appUrl}/upload/${payload.documentId}/review">Review extracted data</a></p>`
    default:
      return `<p><a href="${appUrl}">Log in to Arbor</a></p>`
  }
}
```

---

## Sprint 1.11 — API Routes

Shared helpers — `src/lib/api-helpers.ts`:

```typescript
import { NextResponse } from 'next/server'

export const ok = <T>(data: T, status = 200) => NextResponse.json(data, { status })
export const err = (message: string, code: string, status: number) =>
  NextResponse.json({ error: message, code }, { status })
```

### Routes to create

Every route: validate with Zod, use `requireAuth`, write `AuditEntry` on every mutation, return `{ error, code }` on failure, never expose internal IDs in error messages.

```
POST   /api/documents/upload          — receive file, store in Vercel Blob, dispatch Inngest event
GET    /api/documents/[id]            — return document with extraction job and fields
POST   /api/documents/[id]/confirm    — supplier confirms extracted fields, writes DataRecord, runs cross-validation
GET    /api/records                   — list DataRecords for session entity, filterable by domain/period/tier
GET    /api/records/[id]              — single record with flags and audit chain entry
POST   /api/records/manual            — Tier B manual entry: skip extraction, write DataRecord directly
GET    /api/requests                  — list DataRequests (incoming and outgoing) for session entity
POST   /api/requests                  — buyer creates DataRequest, fires DATA_REQUEST_RECEIVED notification
PATCH  /api/requests/[id]             — update status (SUBMITTED, ACCEPTED, QUERY_RAISED, CLOSED)
GET    /api/audit/[entityId]          — full audit chain for entity, paginated
GET    /api/audit/[entityId]/verify   — run verifyChain, return { verified: boolean }
GET    /api/audit-package/[entityId]  — generate structured audit package for a period
```

The `/confirm` route calls `computeRecordHash` and writes both a `DataRecord` and an `AuditEntry` per field. After writing all records it calls `runCrossValidation`.

**Acceptance test:** Every route returns correct status codes for valid and invalid input. Unauthenticated requests return 401. Entity A cannot read Entity B's records (403). Every mutation produces an `AuditEntry`.

---

## Sprint 1.12 — Supplier Portal UI

### Pages

**`/dashboard`**
- Eight-domain completeness grid: record count, period coverage, trust tier distribution per domain
- Outstanding data requests list
- Supplier Data Readiness Score (% of active records at Tier A)
- Primary action: "Upload documents" — navy, weight 500, top right

**`/upload`**
- Drag-and-drop upload area
- Document type selector (from `DocumentType` enum)
- Extraction progress indicator
- Extracted field review: source text highlighted, confidence score per field, flagged fields in amber
- Inline confirmation: supplier reviews each field and corrects if needed
- Submit writes DataRecords, triggers audit

**`/records`**
- Filterable by domain, period, trust tier
- Every row shows trust tier badge — never hidden
- Source document link per record

**`/requests`**
- Incoming data requests: buyer name, domain, period, required fields, deadline
- "Respond" opens scoped form pre-filtered to the request fields and period

### TierBadge component

`src/components/TierBadge.tsx`:

```typescript
import { trustTierConfig } from '@/lib/design-system'

export function TierBadge({ tier }: { tier: 'A' | 'B' | 'C' }) {
  const config = trustTierConfig[tier]
  return (
    <span
      title={config.description}
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: 500,
        letterSpacing: '0.08em',
        color: config.colour,
        backgroundColor: config.bg,
        textTransform: 'uppercase',
      }}
    >
      {tier} — {config.label}
    </span>
  )
}
```

### Design rules enforced in every component

- All colours from `design-system.ts` — no hex literals in component files
- `fontWeight` is 300 or 500 only
- No `<dialog>` or modal — confirmations use inline conditional rendering
- One primary action per page: navy button, weight 500, top right
- Trust tier visible on every data record — never hidden

**Acceptance test:** Navigate all four pages. Upload a test PDF. Confirm extraction review screen appears with fields, source text, and confidence scores. Confirm a DataRecord is written with correct trust tier and an AuditEntry is created.

---

## Sprint 1.13 — Buyer Interface UI

### Pages

**`/supply-chain`**
- Supplier entity list with per-supplier data coverage by domain and trust tier distribution
- Last submission date per supplier
- "Request data" action per supplier

**`/supply-chain/request/[supplierId]`**
- Domain selector
- Period picker
- Field selector from domain definition
- Optional deadline
- Submit creates `DataRequest`, fires `DATA_REQUEST_RECEIVED` notification to supplier

**`/supply-chain/[supplierId]/records`**
- Read-only view scoped to what the supplier has shared via `DataAccessGrant`
- Trust tier visible on every field
- Gap analysis: required fields at Tier C or absent, highlighted with "Request upgrade" action

**Acceptance test:** Create a data request. Confirm it appears in the supplier's `/requests` view. Confirm supplier can respond. Confirm buyer sees submitted data with trust tiers.

---

## Phase 2 — Expansion (months 7–18)

### Sprint 2.1 — Agricultural Document Types

Activate `CROP_YIELD_RECORD`, `FERTILISER_RECORD`, `LIVESTOCK_RECORD`, `LAND_USE_CERTIFICATE` in the upload UI. These field definitions are already in Sprint 1.5 — activation means surfacing them in the document type selector and adding agricultural-specific extraction prompts covering the nuances in the admissibility spec (nitrogen content compulsory, NPK conditionals).

### Sprint 2.2 — Waste and Water Document Types

Activate `WASTE_RECORD` and `WATER_RECORD`. Add DEFRA Table 8 (2024) emission factors for waste disposal methods. Add Inngest routing for waste/water domain records.

### Sprint 2.3 — Environmental and Compliance Certificates

Activate `ENVIRONMENTAL_CERTIFICATE`, `PRODUCT_CERTIFICATE`, `CHAIN_OF_CUSTODY`, `CARBON_FOOTPRINT_REPORT`.

Add a nightly Inngest cron function that checks all active certificates and raises `EXPIRED_CERTIFICATE` flags where `expiry_date < now()`.

### Sprint 2.4 — Scope 3 Inventory Engine

`src/lib/scope3/inventory.ts` — pure Layer 2 function:

```typescript
// Layer 2 — Scope 3 inventory aggregation
// GHG Protocol Scope 3 Standard — all fifteen categories
// Pure function: no DB reads, no API calls.

import { applyEmissionFactor } from '@/lib/calculation/emission-factors'

export interface Scope3Input {
  records: Array<{
    id: string
    domain: string
    scope3Category: number | null
    fieldName: string
    value: number
    unit: string
    trustTier: 'A' | 'B' | 'C'
    extractionMethod: string
  }>
  emissionFactors: Array<{
    activityType: string
    factor: number
    unit: string
    source: string
    version: string
    citation: string
  }>
}

export interface CategoryResult {
  category: number
  name: string
  totalKgCo2e: number
  byTier: { A: number; B: number; C: number }
  recordCount: number
  isMixedMethod: boolean
  dataComplete: boolean
  lineItems: Array<{
    recordId: string
    fieldName: string
    value: number
    unit: string
    tier: 'A' | 'B' | 'C'
    co2eKg: number
    factorApplied: string
  }>
}

export interface Scope3InventoryResult {
  categories: CategoryResult[]
  totalKgCo2e: number
  coverageReport: {
    fullyDataComplete: number[]
    partiallyEstimated: number[]
    notCovered: number[]
  }
  mixedMethodCategories: number[]
  gapClosePathway: Array<{
    category: number
    tierCVolume: number
    topSuppliersToUpgrade: string[]
  }>
}

const CATEGORY_NAMES: Record<number, string> = {
  1: 'Purchased goods and materials',
  2: 'Capital goods',
  3: 'Fuel and energy related activities',
  4: 'Upstream transportation and distribution',
  5: 'Waste generated in operations',
  6: 'Business travel',
  7: 'Employee commuting',
  8: 'Upstream leased assets',
  9: 'Downstream transportation and distribution',
  10: 'Processing of sold products',
  11: 'Use of sold products',
  12: 'End-of-life treatment of sold products',
  13: 'Downstream leased assets',
  14: 'Franchises',
  15: 'Investments',
}

export function buildScope3Inventory(input: Scope3Input): Scope3InventoryResult {
  const recordsByCategory = new Map<number, typeof input.records>()
  for (const record of input.records) {
    if (record.scope3Category === null) continue
    if (!recordsByCategory.has(record.scope3Category)) recordsByCategory.set(record.scope3Category, [])
    recordsByCategory.get(record.scope3Category)!.push(record)
  }

  const factorMap = new Map(input.emissionFactors.map(f => [f.activityType, f]))
  const categoryMap = new Map<number, CategoryResult>()

  for (const [cat, records] of recordsByCategory.entries()) {
    const byTier = { A: 0, B: 0, C: 0 }
    let totalKgCo2e = 0
    const lineItems = []

    for (const record of records) {
      const factor = factorMap.get(`${record.domain}_${record.fieldName}`)
      let co2eKg = 0
      let factorApplied = 'none'

      if (factor) {
        const calc = applyEmissionFactor({
          activityValue: record.value, activityUnit: record.unit,
          factor: factor.factor, factorUnit: factor.unit,
          factorSource: factor.source, factorVersion: factor.version, citation: factor.citation,
        })
        co2eKg = calc.co2eKg
        factorApplied = calc.calculationExpression
      }

      byTier[record.trustTier] += co2eKg
      totalKgCo2e += co2eKg
      lineItems.push({ recordId: record.id, fieldName: record.fieldName, value: record.value, unit: record.unit, tier: record.trustTier, co2eKg, factorApplied })
    }

    const tiers = new Set(records.map(r => r.trustTier))
    categoryMap.set(cat, {
      category: cat,
      name: CATEGORY_NAMES[cat] ?? `Category ${cat}`,
      totalKgCo2e,
      byTier,
      recordCount: records.length,
      isMixedMethod: tiers.size > 1,
      dataComplete: !tiers.has('C'),
      lineItems,
    })
  }

  const all15 = Array.from({ length: 15 }, (_, i) => i + 1)
  const covered = Array.from(categoryMap.keys())
  const fullyDataComplete = covered.filter(c => categoryMap.get(c)!.dataComplete)
  const partiallyEstimated = covered.filter(c => !categoryMap.get(c)!.dataComplete)
  const notCovered = all15.filter(c => !covered.includes(c))
  const total = Array.from(categoryMap.values()).reduce((s, c) => s + c.totalKgCo2e, 0)

  return {
    categories: Array.from(categoryMap.values()),
    totalKgCo2e: total,
    coverageReport: { fullyDataComplete, partiallyEstimated, notCovered },
    mixedMethodCategories: covered.filter(c => categoryMap.get(c)!.isMixedMethod),
    gapClosePathway: partiallyEstimated.map(cat => ({
      category: cat,
      tierCVolume: categoryMap.get(cat)!.byTier.C,
      topSuppliersToUpgrade: [],
    })),
  }
}
```

### Sprint 2.5 — Audit Package Generation

`src/lib/audit-package/generator.ts` — Layer 3 packaging. Assembles DataRecords, source document index, confidence scores, source text, full audit chain, cross-validation report, and chain integrity verification into a single structured JSON package. Designed for handoff to Bureau Veritas, SGS, Lloyd's Register, EY, or other verifiers without further manual preparation.

### Sprint 2.6 — Supplier Data Readiness Score

`src/lib/readiness-score.ts` — computes percentage of active DataRecords at Tier A by domain. Aggregate score and per-domain breakdown. Interpretation: HIGH (≥75%), MEDIUM (≥40%), LOW (<40%). Visible to supplier. Shared with buyers only with supplier consent.

### Sprint 2.7 — CSRD/ESRS Reporting Template

`src/lib/reporting/csrd.ts` — Layer 3 only. Maps DataRecords to ESRS E1 disclosure tables (Commission Delegated Regulation EU 2023/2772). No calculation logic — translation of existing records into the required format. Trust tier travels with every mapped data point.

### Sprint 2.8 — CBAM Regulatory Output

`src/lib/reporting/cbam-uk.ts` — Layer 3. Quarterly return in HMRC-required format.  
`src/lib/reporting/cbam-eu-xml.ts` — Layer 3. XML submission per EU 2023/1773 Annex I format.

### Sprint 2.9 — External API (v1)

`src/app/api/v1/` — versioned external API for ERP and accounting system integration.  

Authentication: API keys stored in `ApiKey` model (bcrypt-hashed, entity-scoped). Every v1 route validates `Authorization: Bearer <key>`.

```
POST /api/v1/records      — submit structured DataRecords from ERP
GET  /api/v1/records      — retrieve records for the authenticated entity
POST /api/v1/documents    — submit a document for extraction
GET  /api/v1/requests     — retrieve data requests
```

Full API documentation at `/docs/api`.

---

## Phase 3 — Institutional (months 19–36)

### Sprint 3.1 — Aggregated Benchmark Engine

`src/lib/benchmarks/compute.ts` — computes anonymised sector benchmarks from the accumulated Tier A dataset.

Data governance rules enforced in code:
- Minimum 10 distinct entities before any benchmark is computed — function returns `null` if below floor
- Entity-level data never exposed — only statistical outputs (mean, median, p25, p75, n)
- Anonymisation verified before any external release

### Sprint 3.2 — Emission Factor Refinement

`src/lib/factors/refinement.ts` — derives real-world emission factors from the Tier A dataset. Compares derived factors against published defaults (DEFRA, IPCC AR6). Outputs a factor comparison report for human review. Derived factors are never automatically activated — they go through a named approval step before `isActive` is set to `true` and `isDerived` is set to `true`.

### Sprint 3.3 — Multi-jurisdiction Regulatory Output

Extend `src/lib/reporting/` with:
- `eudr.ts` — EUDR traceability output: chain of custody records, geolocation, certification references
- `gri.ts` — GRI Standards tables: GRI 305 (Emissions), GRI 306 (Waste), GRI 303 (Water)
- `cdp.ts` — CDP questionnaire data mapping

---

## Folder Structure

```
arbor/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   └── login/
│   │   ├── (portal)/
│   │   │   ├── dashboard/
│   │   │   ├── upload/
│   │   │   │   └── [id]/review/
│   │   │   ├── records/
│   │   │   └── requests/
│   │   ├── (buyer)/
│   │   │   └── supply-chain/
│   │   │       ├── request/[supplierId]/
│   │   │       └── [supplierId]/records/
│   │   └── api/
│   │       ├── auth/[...nextauth]/
│   │       ├── documents/
│   │       │   ├── upload/
│   │       │   └── [id]/
│   │       │       ├── confirm/
│   │       │       └── route.ts
│   │       ├── records/
│   │       │   ├── manual/
│   │       │   └── [id]/
│   │       ├── requests/
│   │       │   └── [id]/
│   │       ├── audit/
│   │       │   └── [entityId]/
│   │       │       └── verify/
│   │       ├── audit-package/
│   │       │   └── [entityId]/
│   │       ├── inngest/
│   │       └── v1/
│   │           ├── records/
│   │           └── documents/
│   ├── components/
│   │   ├── TierBadge.tsx
│   │   ├── DomainGrid.tsx
│   │   ├── UploadZone.tsx
│   │   ├── ExtractionReview.tsx
│   │   └── Nav.tsx
│   ├── inngest/
│   │   ├── client.ts
│   │   └── functions/
│   │       └── extract-document.ts
│   └── lib/
│       ├── auth.ts
│       ├── auth-helpers.ts
│       ├── prisma.ts
│       ├── storage.ts
│       ├── storage-retrieval.ts
│       ├── notifications.ts
│       ├── api-helpers.ts
│       ├── readiness-score.ts
│       ├── design-system.ts
│       ├── extraction/
│       │   ├── types.ts
│       │   ├── prompts.ts
│       │   ├── field-definitions.ts
│       │   ├── admissibility.ts
│       │   ├── engine.ts
│       │   └── __tests__/
│       │       ├── engine.test.ts
│       │       └── admissibility.test.ts
│       ├── calculation/
│       │   ├── unit-conversion.ts
│       │   ├── emission-factors.ts
│       │   ├── embedded-emissions.ts
│       │   ├── audit-chain.ts
│       │   └── __tests__/
│       │       ├── unit-conversion.test.ts
│       │       └── embedded-emissions.test.ts
│       ├── validation/
│       │   ├── cross-validation.ts
│       │   └── __tests__/
│       │       └── cross-validation.test.ts
│       ├── scope3/
│       │   ├── inventory.ts
│       │   └── __tests__/
│       │       └── inventory.test.ts
│       ├── reporting/
│       │   ├── csrd.ts
│       │   ├── cbam-uk.ts
│       │   ├── cbam-eu-xml.ts
│       │   ├── eudr.ts
│       │   └── gri.ts
│       ├── audit-package/
│       │   └── generator.ts
│       ├── factors/
│       │   └── refinement.ts
│       └── benchmarks/
│           └── compute.ts
├── CLAUDE.md
├── IMPLEMENTATION_PLAN.md
└── .env.example
```

---

## Testing Requirements

Every sprint: write tests before implementation. Test files at `src/lib/**/__tests__/` and `src/app/api/**/__tests__/`.

### Required test categories

**Unit — Layer 2:** every calculation function with known inputs and known outputs.

**@regulatory:** every function implementing a specific regulation article. Test description must include the citation. Examples:
- `[EU 2023/1773 Art. 4(1)] total embedded = direct + indirect`
- `[GHG Protocol Scope 3 Standard] mixed-method categories are flagged`
- `[DEFRA 2024] kWh to MJ conversion factor`

**Admissibility:** every document type's critical rules — estimated reads, code length, expiry dates, CBAM tier requirements, generic fuel type, entity mismatch.

**Extraction:** mocked Anthropic client — correct field mapping, correct content block type (`type:'image'` for JPEG, `type:'document'` for PDF), confidence score handling, JSON parse failure returns `success:false`.

**Audit chain:** `computeRecordHash` is deterministic for identical inputs. `verifyChain` passes a valid chain. `verifyChain` returns false when any entry's payload is tampered.

**Cross-validation:** passes within tolerance, fails beyond tolerance, both-zero edge case.

**API routes:** valid input → correct response, invalid input → 400 with `{ error, code }`, unauthenticated → 401, entity A reading entity B's data → 403.

### Deployment gate — enforced before any production deploy

- All tests pass — zero failures, zero skips
- All `@regulatory` tests pass — zero exceptions
- No test commented out or marked `.skip` to make the suite green
- Layer 2 purity: `grep -r "import.*prisma\|import.*anthropic" src/lib/calculation/` returns zero matches
- `npx tsc --noEmit` exits 0

---

## Environment Variables

```bash
DATABASE_URL=                   # PostgreSQL connection string
NEXTAUTH_SECRET=                # openssl rand -base64 32
NEXTAUTH_URL=                   # http://localhost:3000 in dev; production URL in prod
ANTHROPIC_API_KEY=              # Claude API key
AUDIT_CHAIN_SECRET=             # openssl rand -base64 32 — never expose, never log
BLOB_READ_WRITE_TOKEN=          # Vercel Blob read-write token
RESEND_API_KEY=                 # Resend API key
INNGEST_EVENT_KEY=              # Inngest event key
INNGEST_SIGNING_KEY=            # Inngest signing key
NEXT_PUBLIC_APP_URL=            # Public URL (http://localhost:3000 in dev)
```

---

## Sprint Sequence Summary

| Sprint | Deliverable | Prerequisite |
|--------|-------------|--------------|
| 1.0 | Scaffold, env, Jest config | — |
| 1.1 | Authentication (NextAuth + middleware) | 1.0 |
| 1.2 | File storage (Vercel Blob) | 1.0 |
| 1.3 | Prisma schema (complete with scope3Category) | 1.1 |
| 1.4 | Design system | 1.0 |
| 1.5 | Admissibility framework (field definitions + enforcement) | 1.3 |
| 1.6 | Job queue — Inngest function for async extraction | 1.3, 1.5 |
| 1.7 | Extraction engine — Layer 1, fixed content blocks, prompt caching | 1.5, 1.6 |
| 1.8 | Calculation engine — Layer 2, syntax corrected | 1.3 |
| 1.9 | Cross-validation engine | 1.3, 1.8 |
| 1.10 | Notifications (Resend + DB) | 1.3 |
| 1.11 | API routes (all Phase 1 routes) | 1.1, 1.6, 1.7, 1.8, 1.9, 1.10 |
| 1.12 | Supplier portal UI | 1.4, 1.11 |
| 1.13 | Buyer interface UI | 1.4, 1.11 |
| 2.1 | Agricultural document types activated | Phase 1 complete |
| 2.2 | Waste and water document types activated | Phase 1 complete |
| 2.3 | Environmental and compliance certificates activated | Phase 1 complete |
| 2.4 | Scope 3 inventory engine (all 15 categories) | 2.1–2.3 |
| 2.5 | Audit package generation | 2.4 |
| 2.6 | Supplier Data Readiness Score | Phase 1 complete |
| 2.7 | CSRD/ESRS reporting template | 2.4 |
| 2.8 | CBAM UK and EU regulatory output | 2.4 |
| 2.9 | External API v1 (ERP integration) | Phase 1 complete |
| 3.1 | Aggregated benchmark engine | Phase 2 complete |
| 3.2 | Emission factor refinement from Tier A dataset | 3.1 |
| 3.3 | Multi-jurisdiction output (EUDR, GRI, CDP) | 2.7, 2.8 |

---

*Do not start the next sprint until the current sprint's acceptance test passes. Do not add features not in this plan without a stated first principle. Do not ship without the deployment gate passing.*

**Document version:** 2.0  
**Last updated:** May 2026  
**Owner:** Nucleos Compliance Ltd
