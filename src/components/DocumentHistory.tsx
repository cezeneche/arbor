import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { Pagination, PAGE_SIZE } from '@/components/Pagination'
import { dashboardDate } from '@/lib/layer3/dashboard'
import { dashboardTokens } from '@/components/overview/Dashboard'
import styles from '@/components/overview/Dashboard.module.css'
import { colours, spacing, typography } from '@/lib/design-system'

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
      className={styles.dashboard}
      open={open}
      style={{ ...dashboardTokens, marginTop: spacing[4], borderTop: `1px solid ${colours.border}` }}
    >
      <summary
        style={{
          cursor: 'pointer',
          padding: `${spacing[2]} 0`,
          fontSize: typography.sizes.base,
          fontWeight: typography.weights.medium,
        }}
      >
        Documents
      </summary>
      <div style={{ paddingBottom: spacing[2] }}>
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
