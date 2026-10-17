import Link from 'next/link'
import type { CSSProperties } from 'react'
import { prisma } from '@/lib/prisma'
import { Pagination, PAGE_SIZE } from '@/components/Pagination'
import { dashboardDate } from '@/lib/layer3/dashboard'
import { dashboardTokens } from '@/components/overview/Dashboard'
import styles from '@/components/overview/Dashboard.module.css'
import { borders } from '@/lib/design-system'
import historyStyles from './DocumentHistory.module.css'

export async function DocumentHistory({
  entityId,
  page,
  open,
}: {
  entityId: string
  page: number
  open: boolean
}) {
  const where = { entityId }
  const [documents, total, awaiting] = await Promise.all([
    prisma.document.findMany({
      where,
      select: {
        id: true,
        fileName: true,
        status: true,
        submittedAt: true,
        autoAcceptedAt: true,
        _count: { select: { dataRecords: { where: { isActive: true } } } },
      },
      orderBy: { submittedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.document.count({ where }),
    prisma.document.count({
      where: {
        ...where,
        OR: [{ status: 'REVIEW_REQUIRED' }, { status: 'ACCEPTED', autoAcceptedAt: { not: null } }],
      },
    }),
  ])
  const status = {
    PENDING: 'Waiting to be read',
    EXTRACTING: 'Being read',
    REVIEW_REQUIRED: 'Needs your review',
    ACCEPTED: 'Accepted',
    REJECTED: 'Needs attention',
    WITHDRAWN: 'Withdrawn',
  }
  return (
    <details
      className={`${styles.dashboard} ${historyStyles.history}`}
      open={open}
      style={{ ...dashboardTokens, '--history-radius': borders.radius.lg } as CSSProperties}
    >
      <summary className={historyStyles.summary}>
        <span className={historyStyles.icon} aria-hidden="true">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z" />
            <path d="M14 3v5h5M9 12h6M9 16h6" />
          </svg>
        </span>
        <span className={historyStyles.description}>
          <span className={historyStyles.title}>
            Documents{' '}
            <span className={historyStyles.count} aria-label={`${total} documents`}>
              {total}
            </span>
          </span>
          <span className={historyStyles.caption}>Your uploaded files and their progress</span>
        </span>
        {awaiting > 0 && <span className={historyStyles.reviewBadge}>{awaiting} awaiting review</span>}
        <span className={historyStyles.chevron} aria-hidden="true">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </summary>
      <div className={historyStyles.content}>
        <div className={styles.sectionHead}>
          <p>
            {total} document{total === 1 ? '' : 's'} · {awaiting} awaiting review
          </p>
          <Link className={styles.textLink} href="/review">
            Open review queue →
          </Link>
        </div>
        {documents.length === 0 ? (
          <div className={styles.quiet}>
            <h2>{page > 1 ? 'No documents on this page' : 'Your documents will appear here'}</h2>
            <p>
              Upload an energy bill, delivery note or production record. Review extracted values before using
              them in a response.
            </p>
            {page > 1 && <Link href="/upload?documents=open">Return to the first page</Link>}
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Received</th>
                  <th scope="col">Progress</th>
                  <th scope="col">Stored records</th>
                  <th scope="col">Next step</th>
                </tr>
              </thead>
              <tbody>
                {documents.map(doc => (
                  <tr key={doc.id}>
                    <td className={styles.rowTitle}>{doc.fileName}</td>
                    <td className={styles.date}>{dashboardDate(doc.submittedAt)}</td>
                    <td>{doc.autoAcceptedAt ? 'Stored as Declared · review needed' : status[doc.status]}</td>
                    <td>{doc._count.dataRecords}</td>
                    <td>
                      {doc.status !== 'WITHDRAWN' && (
                        <Link
                          className={styles.textLink}
                          href={`/upload/${encodeURIComponent(doc.id)}/review`}
                        >
                          {doc.status === 'REVIEW_REQUIRED' || doc.autoAcceptedAt
                            ? 'Review values'
                            : 'Open document'}{' '}
                          →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={page}
          totalPages={Math.ceil(total / PAGE_SIZE)}
          buildUrl={p => `/upload?documents=open&page=${p}`}
        />
      </div>
    </details>
  )
}
