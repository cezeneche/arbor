import Link from 'next/link'
import type { CSSProperties } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'
import { DOMAIN_LABELS } from '@/lib/domain-labels'
import { dashboardDate, deadlineLabel, type DashboardTask } from '@/lib/layer3/dashboard'
import type { loadDashboard, DashboardSearchResult } from '@/lib/layer3/dashboard-data'
import { AssignFlag, DashboardViewSwitch } from './DashboardControls'
import styles from './Dashboard.module.css'

type DashboardData = NonNullable<Awaited<ReturnType<typeof loadDashboard>>>
export const dashboardTokens = {
  '--dash-text': colours.textPrimary,
  '--dash-secondary': colours.textSecondary,
  '--dash-surface': colours.surface,
  '--dash-background': colours.background,
  '--dash-border': colours.border,
  '--dash-navy': colours.navy,
  '--dash-red': colours.red,
  '--dash-red-bg': colours.redBg,
  '--dash-amber': colours.amber,
  '--dash-amber-bg': colours.amberBg,
  '--dash-green': colours.green,
  '--dash-green-bg': colours.greenBg,
  '--dash-font': typography.fontFamily,
  '--dash-lg': typography.sizes.lg,
  '--dash-base': typography.sizes.base,
  '--dash-sm': typography.sizes.sm,
  '--dash-xs': typography.sizes.xs,
  '--dash-light': typography.weights.light,
  '--dash-medium': typography.weights.medium,
  '--dash-s1': spacing[1],
  '--dash-s2': spacing[2],
  '--dash-s3': spacing[3],
  '--dash-s4': spacing[4],
} as CSSProperties

function Badge({ task }: { task: DashboardTask }) {
  return (
    <span className={`${styles.badge} ${task.tone === 'neutral' ? '' : styles[task.tone]}`}>
      {task.label}
    </span>
  )
}

function TaskRow({
  task,
  now,
  canAssign = false,
  members = [],
}: {
  task: DashboardTask
  now: Date
  canAssign?: boolean
  members?: DashboardData['members']
}) {
  return (
    <div className={styles.row}>
      <div>
        <Badge task={task} />
        <p className={styles.rowTitle}>{task.title}</p>
        <p className={styles.rowDetail}>{task.detail}</p>
        <p className={styles.rowMeta}>
          {task.owner}
          {task.deadline ? ` · ${deadlineLabel(task.deadline, now)}` : ''}
        </p>
        {canAssign && task.flagId && (
          <AssignFlag flagId={task.flagId} ownerId={task.ownerId} members={members} />
        )}
      </div>
      <Link className={styles.textLink} href={task.href}>
        {task.action} →
      </Link>
    </div>
  )
}

function Hero({
  task,
  now,
  canAssign,
  members,
  canWrite,
}: {
  task: DashboardTask
  now: Date
  canAssign: boolean
  members: DashboardData['members']
  canWrite: boolean
}) {
  return (
    <div className={`${styles.hero} ${task.tone === 'danger' ? styles.heroDanger : ''}`}>
      <div className={styles.kicker}>
        <Badge task={task} />
        {task.deadline && <span>{deadlineLabel(task.deadline, now)}</span>}
      </div>
      <h3>{task.title}</h3>
      <p className={styles.rowDetail}>{task.detail}</p>
      <div className={styles.heroFooter}>
        <Link className={styles.primaryButton} href={task.href}>
          {canWrite ? task.action : 'Open details'} →
        </Link>
        <span className={styles.caption}>{task.owner}</span>
      </div>
      {canAssign && task.flagId && (
        <AssignFlag flagId={task.flagId} ownerId={task.ownerId} members={members} />
      )}
    </div>
  )
}

function StoredData({ data, canWrite }: { data: DashboardData; canWrite: boolean }) {
  if (!data.domains.length && (data.reviewCount || data.processingCount)) return null
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2>Stored data</h2>
          <p className={styles.caption}>
            Find the records and sources for a response, questionnaire or export.
          </p>
        </div>
        <Link className={styles.textLink} href="/records">
          Browse all data →
        </Link>
      </div>
      {data.domains.length === 0 ? (
        <div className={styles.quiet}>
          <h3>Build your organisation’s data record</h3>
          <p>
            Start with an energy bill, delivery note or production record. Confirmed values stay linked to
            their source for reuse.
          </p>
          <Link className={styles.outlineButton} href={canWrite ? '/upload' : '/records'}>
            {canWrite ? 'Add your first document' : 'Browse records'} →
          </Link>
        </div>
      ) : (
        <div className={styles.records}>
          {data.domains.map(domain => (
            <article key={domain.domain} className={styles.record}>
              <h3>{domain.label}</h3>
              <p className={styles.caption}>
                {domain.count.toLocaleString('en-GB')} stored records · latest period ends{' '}
                {dashboardDate(domain.latestPeriod)}
              </p>
              <div className={styles.recordCounts}>
                {domain.verified > 0 && <span>{domain.verified} Verified</span>}
                {domain.declared > 0 && <span>{domain.declared} Declared</span>}
                {domain.estimated > 0 && <span>{domain.estimated} Estimated</span>}
              </div>
              <Link className={styles.textLink} href={`/records?domain=${domain.domain}`}>
                Open records →
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export function Dashboard({
  data,
  view,
  query,
  results,
  now,
  canAssign,
  canWrite,
}: {
  data: DashboardData
  view: 'work' | 'organisation'
  query: string
  results: DashboardSearchResult[]
  now: Date
  canAssign: boolean
  canWrite: boolean
}) {
  const personal = view === 'work'
  const [first, ...remaining] = data.tasks
  const upcoming = data.commitments.filter(
    c => c.deadline && Date.parse(c.deadline) <= now.getTime() + 14 * 86_400_000,
  )
  const due = upcoming.find(c => !c.ready && !['Awaiting buyer', 'Response received'].includes(c.status))
  const urgent: DashboardTask | undefined =
    data.interventions[0] ??
    (due
      ? {
          id: due.id,
          kind: 'request',
          title: `${due.title}: ${due.status.toLowerCase()}`,
          detail: due.detail,
          href: due.href,
          action: 'Inspect request',
          owner: due.owner,
          ownerId: null,
          deadline: due.deadline,
          tone: due.deadline && Date.parse(due.deadline) < now.getTime() ? 'danger' : 'warning',
          label: 'Commitment approaching',
        }
      : undefined)
  const intervention: DashboardTask | undefined =
    urgent ??
    (data.reviewCount > 0
      ? {
          id: 'document-review',
          kind: 'review',
          title: `${data.reviewCount} document${data.reviewCount === 1 ? '' : 's'} awaiting review`,
          detail: 'Review the extracted values so your team can use the data.',
          href: '/review',
          action: 'Review documents',
          owner: 'Organisation review queue',
          ownerId: null,
          deadline: null,
          tone: 'neutral',
          label: 'Review needed',
        }
      : undefined)
  const furtherInterventions = data.interventions.filter(task => task.id !== intervention?.id)
  const expiringShares = data.shares.filter(
    s => s.expiresAt && s.expiresAt.getTime() <= now.getTime() + 7 * 86_400_000,
  )

  return (
    <div className={styles.dashboard} style={dashboardTokens}>
      <div className={styles.context}>
        <div>
          <p className={styles.entity}>{data.entity.legalName}</p>
          <p className={styles.caption}>
            {personal ? 'Your work and the shared team queue' : 'Organisation-wide work'}
          </p>
        </div>
        <DashboardViewSwitch view={view} query={query} />
      </div>
      <header className={styles.heading}>
        <div>
          <h1>{personal ? 'My work' : 'Organisation overview'}</h1>
          <p className={styles.subtitle}>
            {personal
              ? 'Finish the next step. Keep your data ready to use.'
              : 'See what is due, what is blocked and who can move it forward.'}
          </p>
        </div>
        {canWrite && (
          <Link className={styles.outlineButton} href="/upload">
            + Add documents
          </Link>
        )}
      </header>
      {!canWrite && (
        <p className={styles.caption}>
          Your account has read-only access. You can inspect work and stored data.
        </p>
      )}
      <form action="/dashboard" method="get" className={styles.search} role="search">
        <input type="hidden" name="view" value={view} />
        <label>
          <span className={styles.srOnly}>Find stored data, documents or requests</span>
          <input
            name="q"
            type="search"
            defaultValue={query}
            key={query}
            maxLength={120}
            placeholder="Find a field, document, data type or organisation"
          />
        </label>
        <button className={styles.outlineButton} type="submit">
          Search
        </button>
      </form>
      {query && (
        <section className={styles.searchResults}>
          <div className={styles.sectionHead}>
            <div>
              <h2>Results for “{query}”</h2>
              <p className={styles.caption}>Up to 12 matches per category, within your organisation.</p>
            </div>
            <Link className={styles.textLink} href={`/dashboard?view=${view}`}>
              Clear search
            </Link>
          </div>
          {results.length === 0 ? (
            <p>No matches. Try a document name, data type or organisation.</p>
          ) : (
            results.map(result => (
              <div className={styles.row} key={result.id}>
                <div>
                  <span className={styles.caption}>{result.kind}</span>
                  <p className={styles.rowTitle}>{result.title}</p>
                  <p className={styles.caption}>{result.detail}</p>
                </div>
                <Link className={styles.textLink} href={result.href}>
                  Open →
                </Link>
              </div>
            ))
          )}
        </section>
      )}

      {!query && (
        <>
          {personal ? (
            <>
              <section>
                <div className={styles.sectionHead}>
                  <h2>Start here</h2>
                </div>
                {first ? (
                  <Hero task={first} now={now} canAssign={false} members={data.members} canWrite={canWrite} />
                ) : (
                  <div className={styles.quiet}>
                    <h3>{data.processingCount ? 'Documents are being read' : 'No actions in your queue'}</h3>
                    <p>
                      {data.processingCount
                        ? `${data.processingCount} document${data.processingCount === 1 ? ' is' : 's are'} processing. Check back for extracted values to review.`
                        : 'Browse your stored data, answer a questionnaire or check the organisation view for work owned by your colleagues.'}
                    </p>
                    <Link href="/records" className={styles.primaryButton}>
                      Find stored data →
                    </Link>
                  </div>
                )}
              </section>
              {(remaining.length > 0 ||
                data.personalWaiting.length > 0 ||
                (first && data.processingCount > 0)) && (
                <div className={styles.columns}>
                  {remaining.length > 0 && (
                    <section>
                      <div className={styles.sectionHead}>
                        <h2>Also on your list</h2>
                        <span className={styles.caption}>{remaining.length} items</span>
                      </div>
                      {remaining.slice(0, 5).map(task => (
                        <TaskRow key={task.id} task={task} now={now} />
                      ))}
                      {remaining.length > 5 && (
                        <details>
                          <summary className={styles.textButton}>
                            Show {remaining.length - 5} more items
                          </summary>
                          {remaining.slice(5).map(task => (
                            <TaskRow key={task.id} task={task} now={now} />
                          ))}
                        </details>
                      )}
                    </section>
                  )}
                  {(data.personalWaiting.length > 0 || (first && data.processingCount > 0)) && (
                    <aside>
                      {data.personalWaiting.length > 0 && (
                        <>
                          <div className={styles.sectionHead}>
                            <h2>Waiting on others</h2>
                          </div>
                          {data.personalWaiting.slice(0, 3).map(task => (
                            <TaskRow key={task.id} task={task} now={now} />
                          ))}
                          {data.personalWaiting.length > 3 && (
                            <details>
                              <summary className={styles.textButton}>
                                Show {data.personalWaiting.length - 3} more dependencies
                              </summary>
                              {data.personalWaiting.slice(3).map(task => (
                                <TaskRow key={task.id} task={task} now={now} />
                              ))}
                            </details>
                          )}
                        </>
                      )}
                      {first && data.processingCount > 0 && (
                        <p className={styles.processing}>
                          {data.processingCount} document{data.processingCount === 1 ? ' is' : 's are'} being
                          read. <Link href="/documents">Check progress →</Link>
                        </p>
                      )}
                    </aside>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {data.commitments.length > 0 && (
                <div className={styles.summary}>
                  <div>
                    <div className={styles.stat}>
                      <span className={styles.number}>{data.commitments.length}</span>
                      <span>open data requests</span>
                    </div>
                  </div>
                  <div>
                    <div className={styles.stat}>
                      <span className={styles.number}>{upcoming.length}</span>
                      <span>due within 14 days or overdue</span>
                    </div>
                  </div>
                  <div>
                    <div className={styles.stat}>
                      <span className={styles.number}>{data.commitments.filter(c => c.ready).length}</span>
                      <span>with requested fields available</span>
                    </div>
                  </div>
                </div>
              )}
              <section>
                <div className={styles.sectionHead}>
                  <h2>Your intervention</h2>
                  <Link className={styles.textLink} href="/settings/stewards">
                    Data owners →
                  </Link>
                </div>
                {intervention ? (
                  <Hero
                    task={intervention}
                    now={now}
                    canAssign={canAssign}
                    members={data.members}
                    canWrite={canWrite}
                  />
                ) : (
                  <div className={styles.quiet}>
                    <h3>No urgent intervention flagged</h3>
                    <p>
                      {data.commitments.length
                        ? 'Open requests and their owners are listed below.'
                        : 'There are no open data requests or urgent issues in the team queue.'}
                    </p>
                    <Link className={styles.primaryButton} href="/records">
                      Browse stored data →
                    </Link>
                  </div>
                )}
              </section>
              {data.commitments.length > 0 && (
                <section className={styles.section}>
                  <div className={styles.sectionHead}>
                    <div>
                      <h2>Open commitments</h2>
                      <p className={styles.caption}>
                        Requested period, deadline, remaining work and responsibility.
                      </p>
                    </div>
                    <Link className={styles.textLink} href="/requests">
                      All requests →
                    </Link>
                  </div>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th scope="col">Commitment</th>
                          <th scope="col">Due</th>
                          <th scope="col">Readiness and next step</th>
                          <th scope="col">Responsibility</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.commitments.slice(0, 6).map(c => (
                          <tr key={c.id}>
                            <td>
                              <Link className={styles.textLink} href={c.href}>
                                {c.title}
                              </Link>
                              <p className={styles.caption}>{c.scope}</p>
                              <p className={styles.caption}>
                                {c.direction === 'incoming'
                                  ? 'They requested our data'
                                  : 'We requested their data'}
                              </p>
                            </td>
                            <td className={styles.date}>{dashboardDate(c.deadline)}</td>
                            <td>
                              <span className={`${styles.badge} ${c.ready ? styles.good : styles.warning}`}>
                                {c.status}
                              </span>
                              <p className={styles.rowDetail}>{c.detail}</p>
                            </td>
                            <td>
                              <p className={styles.rowTitle}>{c.owner}</p>
                              <p className={styles.caption}>
                                {c.direction === 'incoming' ? 'Data stewardship' : 'Requested by'}
                              </p>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {data.commitments.length > 6 && (
                    <p className={styles.caption}>
                      Showing the six nearest deadlines.{' '}
                      <Link href="/requests/data">View all {data.commitments.length} open requests →</Link>
                    </p>
                  )}
                </section>
              )}
              {(furtherInterventions.length > 0 || expiringShares.length > 0) && (
                <div className={styles.columns}>
                  {furtherInterventions.length > 0 && (
                    <section>
                      <div className={styles.sectionHead}>
                        <h2>Other issues needing attention</h2>
                      </div>
                      {furtherInterventions.slice(0, 5).map(task => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          now={now}
                          canAssign={canAssign}
                          members={data.members}
                        />
                      ))}
                      {furtherInterventions.length > 5 && (
                        <details>
                          <summary className={styles.textButton}>
                            Show {furtherInterventions.length - 5} more issues
                          </summary>
                          {furtherInterventions.slice(5).map(task => (
                            <TaskRow
                              key={task.id}
                              task={task}
                              now={now}
                              canAssign={canAssign}
                              members={data.members}
                            />
                          ))}
                        </details>
                      )}
                    </section>
                  )}
                  {expiringShares.length > 0 && (
                    <aside>
                      <div className={styles.sectionHead}>
                        <h2>Sharing expires soon</h2>
                      </div>
                      {expiringShares.slice(0, 3).map(s => (
                        <div key={s.id} className={styles.row}>
                          <div>
                            <p className={styles.rowTitle}>
                              {s.domain ? DOMAIN_LABELS[s.domain] : 'All data'} share ends{' '}
                              {dashboardDate(s.expiresAt)}
                            </p>
                            <Link className={styles.textLink} href="/shares">
                              Review shared link →
                            </Link>
                          </div>
                        </div>
                      ))}
                      {expiringShares.length > 3 && (
                        <Link className={styles.textLink} href="/shares">
                          View all {expiringShares.length} expiring links →
                        </Link>
                      )}
                    </aside>
                  )}
                </div>
              )}
              {(data.processingCount > 0 || (urgent && data.reviewCount > 0)) && (
                <p className={styles.processing}>
                  {urgent && data.reviewCount > 0 && (
                    <>
                      <Link href="/review">{data.reviewCount} documents awaiting review →</Link>
                      {data.processingCount > 0 ? ' · ' : ''}
                    </>
                  )}
                  {data.processingCount > 0 && (
                    <>
                      <span>{data.processingCount} documents being read. </span>
                      <Link href="/documents">Check progress →</Link>
                    </>
                  )}
                </p>
              )}
            </>
          )}
          <StoredData data={data} canWrite={canWrite} />
          {data.caseCount > 0 && (
            <div className={styles.footer}>
              <p>
                {data.caseCount} CBAM case{data.caseCount === 1 ? '' : 's'} · check return readiness in each
                case
              </p>
              <Link className={styles.textLink} href="/cbam?view=cases">
                Open CBAM cases →
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  )
}
