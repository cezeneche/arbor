'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import styles from './Dashboard.module.css'

export function DashboardViewSwitch({ view, query }: { view: 'work' | 'organisation'; query: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <label className={styles.viewControl}>
      <span>Dashboard view</span>
      <select
        value={view}
        aria-label="Dashboard view"
        disabled={pending}
        onChange={event => {
          const params = new URLSearchParams({ view: event.target.value })
          if (query) params.set('q', query)
          startTransition(() => router.push(`/dashboard?${params}`))
        }}
      >
        <option value="work">My work</option>
        <option value="organisation">Organisation</option>
      </select>
      {pending && <span role="status">Updating…</span>}
    </label>
  )
}

export function AssignFlag({
  flagId,
  ownerId,
  members,
}: {
  flagId: string
  ownerId: string | null
  members: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState(ownerId ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function assign() {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/flags/${encodeURIComponent(flagId)}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selected }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Could not assign this issue.')
      setEditing(false)
      setMessage(`Assigned to ${result.assigneeName}.`)
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not assign this issue. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.assignment}>
      {!editing ? (
        <button className={styles.textButton} onClick={() => setEditing(true)}>
          {ownerId ? 'Change owner' : 'Assign an owner'} →
        </button>
      ) : (
        <div className={styles.assignmentForm}>
          <label>
            Responsible person
            <select
              aria-label="Responsible person"
              value={selected}
              disabled={busy}
              onChange={e => setSelected(e.target.value)}
            >
              <option value="">Choose a team member</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <button className={styles.outlineButton} disabled={busy || !selected} onClick={assign}>
            {busy ? 'Saving…' : 'Save owner'}
          </button>
          <button className={styles.textButton} disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      )}
      {message && (
        <p role="status" className={styles.caption}>
          {message}
        </p>
      )}
    </div>
  )
}
