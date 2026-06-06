import { createClient } from '@supabase/supabase-js'

let _client: ReturnType<typeof createClient> | null = null

export function getSupabaseAdmin() {
  if (_client) return _client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
  _client = createClient(url, key, { auth: { persistSession: false } })
  return _client
}

export const DOCUMENTS_BUCKET = 'documents'
