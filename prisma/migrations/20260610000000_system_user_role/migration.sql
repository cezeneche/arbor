-- Add SYSTEM role to UserRole enum.
-- Used by getSystemUser() to identify integration/machine writes,
-- so API-key ingest records are not attributed to a human admin user.
ALTER TYPE "UserRole" ADD VALUE 'SYSTEM';
