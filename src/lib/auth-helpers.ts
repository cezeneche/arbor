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
