// Layer 2 — TLS policy for the database connection.
//
// Certified records travel between Vercel and Supabase over the public internet.
// Supabase's pooler accepts plaintext connections, and its certificate chains to
// Supabase's own root, which Node does not trust by default. So a URL without
// sslmode connects unencrypted, and one with sslmode=require fails to verify.
// Every remote connection therefore gets verified TLS against the public roots
// plus Supabase's root, whatever the URL says: pg lets URL parameters override
// the ssl option, so the URL's TLS parameters are removed rather than trusted.
//
// A database on this machine (local dev, CI's Postgres service) is left alone.
import { rootCertificates } from 'node:tls'

// Supabase Root 2021 CA, valid to 26 April 2031. Checked 17 October 2026: the
// same certificate (SHA-256 80:70:25:AD:…:CA:FA) is the root the live pooler
// presents and the one Supabase publishes as prod-ca-2021.crt. A test pins the
// fingerprint and fails 90 days before expiry.
export const SUPABASE_ROOT_CA_2021 = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----
`

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

// Every URL parameter pg-connection-string reads into its TLS settings.
const TLS_PARAMS = ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']

export interface DatabaseConnection {
  connectionString: string | undefined
  ssl?: { rejectUnauthorized: true; ca: string[] }
}

export function databaseConnection(connectionString: string | undefined): DatabaseConnection {
  if (!connectionString) return { connectionString }

  const url = new URL(connectionString)
  if (LOCAL_HOSTS.has(url.hostname)) return { connectionString }

  for (const param of TLS_PARAMS) url.searchParams.delete(param)
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, ca: [...rootCertificates, SUPABASE_ROOT_CA_2021] },
  }
}

// Prisma's schema engine, which `prisma migrate` uses, connects on its own and
// reads TLS only from the URL; it never sees the options above. With no
// sslmode it tries TLS and falls back to plaintext, so a migration could run
// unencrypted. Remote URLs therefore get sslmode=require, replacing whatever
// TLS settings they carry.
//
// This encrypts but does not verify the certificate: the schema engine refuses
// Supabase's chain even when given Supabase's root (sslaccept=strict with
// sslrootcert, checked 9 November 2026), and accepts it only unverified. The
// app's own connections, which carry every certified write, stay verified.
const PRISMA_TLS_PARAMS = ['sslmode', 'sslaccept', 'sslcert', 'sslidentity', 'sslpassword', 'sslrootcert']

export function migrationDatabaseUrl(connectionString: string | undefined): string | undefined {
  if (!connectionString) return connectionString

  const url = new URL(connectionString)
  if (LOCAL_HOSTS.has(url.hostname)) return connectionString

  for (const param of PRISMA_TLS_PARAMS) url.searchParams.delete(param)
  url.searchParams.set('sslmode', 'require')
  return url.toString()
}
