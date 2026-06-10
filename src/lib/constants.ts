import { z } from 'zod'
import { DataDomain, TrustTier, ExtractionMethod } from '@prisma/client'

export { DataDomain, TrustTier, ExtractionMethod }

export const domainSchema = z.nativeEnum(DataDomain)
export const tierSchema = z.nativeEnum(TrustTier)
export const extractionMethodSchema = z.nativeEnum(ExtractionMethod)

export const ALL_DOMAINS = Object.values(DataDomain)
export const ALL_TIERS = Object.values(TrustTier)
