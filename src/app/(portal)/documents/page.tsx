import { redirect } from 'next/navigation'
import { requirePageSession } from '@/lib/page-auth'
import { parsePage } from '@/lib/pagination'

// Existing document links open the history inside Uploads.
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requirePageSession()
  const { page } = await searchParams
  redirect(`/upload?documents=open&page=${parsePage(page)}`)
}
