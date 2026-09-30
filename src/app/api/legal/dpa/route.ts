import { NextRequest, NextResponse } from 'next/server'

// Keep old download links working without serving a second, conflicting set of
// legal terms. The page is the sole review copy until counsel approves an export.
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/legal/dpa', request.url), 307)
}
