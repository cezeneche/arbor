import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

// Structural guard for finding S1 (PR2): every cross-tenant /api/admin route must
// gate on requirePlatformAdmin — never the tenant-level requireAdmin. This fails
// loudly if a new admin route (or a regression) reintroduces the tenant-admin gate.
const ADMIN_DIR = join(process.cwd(), 'src/app/api/admin')

function findRouteFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...findRouteFiles(full))
    else if (entry === 'route.ts' || entry === 'route.tsx') out.push(full)
  }
  return out
}

describe('/api/admin route guards', () => {
  const files = findRouteFiles(ADMIN_DIR)

  it('finds the admin route files', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s gates on requirePlatformAdmin, not requireAdmin', (file) => {
    const src = readFileSync(file, 'utf8')
    expect(src).toContain('requirePlatformAdmin')
    // No bare tenant-level guard (requirePlatformAdmin does not contain this substring).
    expect(src).not.toMatch(/\brequireAdmin\b/)
  })
})
