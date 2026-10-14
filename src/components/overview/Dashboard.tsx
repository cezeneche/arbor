import Link from 'next/link'
import type { CSSProperties } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'
import { DOMAIN_LABELS } from '@/lib/domain-labels'
import { fieldLabel } from '@/lib/layer3/field-label'
import { dashboardDate, deadlineLabel, recordHref, type DashboardTask } from '@/lib/layer3/dashboard'
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
        <span>{deadlineLabel(task.deadline, now)}</span>
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
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2>Use what is already stored</h2>
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
            {data.reviewCount
              ? 'Documents are waiting for review. Confirm their values to make them available here.'
              : 'Start with an energy bill, delivery note or production record. Confirmed values stay linked to their source for reuse.'}
          </p>
          <Link
            className={styles.outlineButton}
            href={data.reviewCount ? '/review' : canWrite ? '/upload' : '/records'}
          >
            {data.reviewCount ? 'Open review queue' : canWrite ? 'Add your first document' : 'Browse records'}{' '}
            →
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
      <div className={styles.actions}>
        <Link className={styles.textLink} href="/questionnaires">
          Answer a questionnaire →
        </Link>
        <Link className={styles.textLink} href="/export">
          Prepare an export →
        </Link>
        {data.entity.entityType === 'BUYER' && (
          <Link className={styles.textLink} href="/supply-chain">
            Find shared supplier data →
          </Link>
        )}
      </div>
    </section>
  )
}

function CbamSummary({ data }: { data: DashboardData }) {
  if (!data.showCbam) return null
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>CBAM work</h2>
        <Link className={styles.textLink} href="/cbam?view=cases">
          Open CBAM →
        </Link>
      </div>
      <p>
        {data.caseCount} linked case{data.caseCount === 1 ? '' : 's'}
        {data.unfinishedCases > 0
          ? ` · ${data.unfinishedCases} document handoff${data.unfinishedCases === 1 ? '' : 's'} unfinished`
          : ''}
      </p>
      <p className={styles.caption}>
        Check goods lines, supplier information and return readiness inside each case. A saved document does
        not establish a complete return.
      </p>
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
  const intervention: DashboardTask | undefined =
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
  const expiringShares = data.shares.filter(
    s => s.expiresAt && s.expiresAt.getTime() <= now.getTime() + 7 * 86_400_000,
  )

  return (
    <div className={styles.dashboard} style={dashboardTokens}>
      <div className={styles.context}>
        <div>
          <p className={styles.entity}>{data.entity.legalName}</p>
          <p className={styles.caption}>
            {dashboardDate(now)} ·{' '}
            {personal ? 'Your work and the shared team queue' : 'Organisation-wide work and dependencies'}
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

      {personal ? (
        <>
          <section>
            <div className={styles.sectionHead}>
              <h2>Start here</h2>
              <span className={styles.caption}>Deadline, impact and the next useful action</span>
            </div>
            {first ? (
              <Hero task={first} now={now} canAssign={false} members={data.members} canWrite={canWrite} />
            ) : (
              <div className={styles.quiet}>
                <h3>{data.processingCount ? 'Your documents are being read' : 'No actions in your queue'}</h3>
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
          <div className={styles.columns}>
            <section>
              <div className={styles.sectionHead}>
                <h2>Also on your list</h2>
                <span className={styles.caption}>
                  {remaining.length} further item{remaining.length === 1 ? '' : 's'}
                </span>
              </div>
              {remaining.length === 0 ? (
                <p className={styles.empty}>
                  No other actions assigned to you or waiting in the shared queue.
                </p>
              ) : (
                remaining.slice(0, 8).map(task => <TaskRow key={task.id} task={task} now={now} />)
              )}
              {remaining.length > 8 && (
                <details>
                  <summary className={styles.textButton}>Show {remaining.length - 8} more items</summary>
                  {remaining.slice(8).map(task => (
                    <TaskRow key={task.id} task={task} now={now} />
                  ))}
                </details>
              )}
            </section>
            <aside>
              <div className={styles.sectionHead}>
                <h2>Waiting on others</h2>
              </div>
              {data.waiting.length === 0 ? (
                <p className={styles.empty}>No outstanding supplier responses or buyer reviews.</p>
              ) : (
                data.waiting.slice(0, 5).map(task => <TaskRow key={task.id} task={task} now={now} />)
              )}
              {data.waiting.length > 5 && (
                <Link className={styles.textLink} href="/requests?view=request">
                  View all requests →
                </Link>
              )}
              <div className={styles.section}>
                <h2>Document progress</h2>
                <p className={styles.rowDetail}>
                  {data.reviewCount} awaiting review · {data.processingCount} being read
                </p>
                <Link href="/review" className={styles.textLink}>
                  Open review queue →
                </Link>
              </div>
            </aside>
          </div>
        </>
      ) : (
        <>
          <div className={styles.summary}>
            <div>
              <div className={styles.stat}>
                <span className={styles.number}>{data.commitments.length}</span>
                <span>open data requests</span>
              </div>
              <p className={styles.caption}>Incoming commitments and supplier requests</p>
            </div>
            <div>
              <div className={styles.stat}>
                <span className={styles.number}>{upcoming.length}</span>
                <span>due within 14 days or overdue</span>
              </div>
              <p className={styles.caption}>Only deadlines set on the actual request</p>
            </div>
            <div>
              <div className={styles.stat}>
                <span className={styles.number}>{data.commitments.filter(c => c.ready).length}</span>
                <span>with requested fields available</span>
              </div>
              <p className={styles.caption}>Review sources and labels before responding</p>
            </div>
          </div>
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
                  Review open requests and document progress below. This status does not certify data
                  completeness or filing readiness.
                </p>
                <Link className={styles.outlineButton} href="/requests">
                  Review requests →
                </Link>
              </div>
            )}
          </section>
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <div>
                <h2>What the organisation is working towards</h2>
                <p className={styles.caption}>
                  Requested period, deadline, remaining work and responsibility.
                </p>
              </div>
              <Link className={styles.textLink} href="/requests">
                All requests →
              </Link>
            </div>
            {data.commitments.length === 0 ? (
              <div className={styles.quiet}>
                <h3>No open data requests</h3>
                <p>
                  Your stored data is available for reuse. Create a supplier request when you need specific
                  fields and periods.
                </p>
                <Link className={styles.textLink} href="/requests?view=request">
                  Request data →
                </Link>
              </div>
            ) : (
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
                    {data.commitments.map(c => (
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
            )}
          </section>
          <div className={styles.columns}>
            <section>
              <div className={styles.sectionHead}>
                <h2>Quality and ownership</h2>
              </div>
              {data.interventions.filter(t => t.id !== intervention?.id).length === 0 ? (
                <p className={styles.empty}>No further critical, overdue or unassigned issues flagged.</p>
              ) : (
                data.interventions
                  .filter(t => t.id !== intervention?.id)
                  .slice(0, 6)
                  .map(task => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      now={now}
                      canAssign={canAssign}
                      members={data.members}
                    />
                  ))
              )}
              {data.interventions.length > 7 && (
                <Link className={styles.textLink} href="/settings/stewards">
                  View the full team workload →
                </Link>
              )}
              <div className={styles.section}>
                <h2>Document progress</h2>
                <p className={styles.rowDetail}>
                  {data.reviewCount} awaiting review · {data.processingCount} being read
                </p>
                <Link className={styles.textLink} href="/review">
                  Inspect the review queue →
                </Link>
              </div>
            </section>
            <aside>
              <div className={styles.sectionHead}>
                <h2>Access and dependencies</h2>
              </div>
              <p>
                {data.grantCount} active access grant{data.grantCount === 1 ? '' : 's'} · {data.shares.length}{' '}
                active shared link{data.shares.length === 1 ? '' : 's'}
              </p>
              {expiringShares.length > 0 ? (
                expiringShares.slice(0, 3).map(s => (
                  <div key={s.id} className={styles.row}>
                    <div>
                      <p className={styles.rowTitle}>
                        {s.domain ? DOMAIN_LABELS[s.domain] : 'All-domain'} share ends{' '}
                        {dashboardDate(s.expiresAt)}
                      </p>
                      <p className={styles.caption}>
                        {s.isSnapshot
                          ? 'Snapshot of the records selected when shared'
                          : 'Ongoing scoped access'}
                      </p>
                      <Link className={styles.textLink} href="/shares">
                        Review shared link →
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <p className={styles.caption}>No active shared links expire in the next seven days.</p>
              )}
              <div className={styles.actions}>
                <Link className={styles.textLink} href="/access">
                  Review access →
                </Link>
                <Link className={styles.textLink} href="/shares">
                  Shared links →
                </Link>
              </div>
              {data.waiting.slice(0, 3).map(task => (
                <TaskRow key={task.id} task={task} now={now} />
              ))}
            </aside>
          </div>
        </>
      )}
      <StoredData data={data} canWrite={canWrite} />
      <CbamSummary data={data} />
      <footer className={styles.footer}>
        <div>
          <h2>Recently stored</h2>
          {data.recent.length === 0 ? (
            <p className={styles.caption}>Confirmed records will appear here with their source history.</p>
          ) : (
            data.recent.map(r => (
              <p className={styles.caption} key={r.id}>
                <Link href={recordHref(r.id)}>{fieldLabel(r.fieldName, r.domain)}</Link> ·{' '}
                {r.submittedBy.name} · {dashboardDate(r.submittedAt)}
              </p>
            ))
          )}
        </div>
        <Link className={styles.textLink} href="/activity">
          Full history →
        </Link>
      </footer>
    </div>
  )
}
