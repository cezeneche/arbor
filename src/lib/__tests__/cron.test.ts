import { NextRequest } from 'next/server'
import { cronRoute, cronSchedule, isCronRequest, type CronDeps } from '@/lib/cron'

const req = (auth?: string) =>
  new NextRequest('http://arbor.test/api/cron/keepalive', { headers: auth ? { authorization: auth } : {} })

describe('isCronRequest', () => {
  // Expected: only the exact bearer passes, and an unset secret passes nothing.
  // Reason: these routes touch every entity's data; failing closed is the point.
  it.each([
    ['Bearer s3cret', 's3cret', true],
    ['Bearer wrong', 's3cret', false],
    ['Bearer s3cret ', 's3cret', false],
    ['s3cret', 's3cret', false],
    [null, 's3cret', false],
    ['Bearer ', '', false],
    ['Bearer undefined', undefined, false],
  ])('%s with secret %s → %s', (header, secret, expected) => {
    expect(isCronRequest(header, secret)).toBe(expected)
  })
})

describe('cronSchedule', () => {
  // Expected: the schedule vercel.json gives the path. Reason: the monitor must
  // expect runs exactly when Vercel makes them, from one source.
  it('reads the schedule from vercel.json', () => {
    expect(cronSchedule('/api/cron/keepalive')).toBe('0 6 * * *')
    expect(cronSchedule('/api/cron/calibrate')).toBe('0 3 * * *')
  })

  it('is null for a route Vercel does not schedule', () => {
    expect(cronSchedule('/api/cron/project-graph')).toBeNull()
  })
})

describe('cronRoute', () => {
  function deps() {
    const checkIns: { checkIn: Record<string, unknown>; config?: Record<string, unknown> }[] = []
    const d: CronDeps = {
      secret: 's3cret',
      captureCheckIn: (checkIn, config) => {
        checkIns.push({
          checkIn: checkIn as unknown as Record<string, unknown>,
          config: config as unknown as Record<string, unknown>,
        })
        return 'check-in-1'
      },
      flush: jest.fn(async () => true),
    }
    return { d, checkIns }
  }

  // Expected: 401 and no check-in. Reason: a stray caller must not count as a
  // run, or it could hide a real missed one.
  it('refuses a caller without the secret, recording nothing', async () => {
    const { d, checkIns } = deps()
    const handler = jest.fn()
    const res = await cronRoute('/api/cron/keepalive', handler, d)(req('Bearer nope'))
    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
    expect(checkIns).toHaveLength(0)
  })

  // Expected: in_progress with the monitor config, then ok, then a flush.
  it('checks in around a successful run', async () => {
    const { d, checkIns } = deps()
    const res = await cronRoute(
      '/api/cron/keepalive',
      async () => new Response('ok'),
      d,
    )(req('Bearer s3cret'))
    expect(res.status).toBe(200)
    expect(checkIns[0]).toEqual({
      checkIn: { monitorSlug: 'cron-keepalive', status: 'in_progress' },
      config: {
        schedule: { type: 'crontab', value: '0 6 * * *' },
        timezone: 'Etc/UTC',
        checkinMargin: 10,
        maxRuntime: 10,
        failureIssueThreshold: 1,
        recoveryThreshold: 1,
      },
    })
    expect(checkIns[1].checkIn).toMatchObject({
      monitorSlug: 'cron-keepalive',
      status: 'ok',
      checkInId: 'check-in-1',
    })
    expect(d.flush).toHaveBeenCalled()
  })

  // Expected: a 5xx answer is a failed run. Reason: these jobs report failure
  // by status (keepalive answers 500 when the database is down), not by throwing.
  it('records a 5xx answer as an error', async () => {
    const { d, checkIns } = deps()
    await cronRoute(
      '/api/cron/keepalive',
      async () => new Response('down', { status: 500 }),
      d,
    )(req('Bearer s3cret'))
    expect(checkIns[1].checkIn.status).toBe('error')
  })

  it('records a throw as an error and rethrows it', async () => {
    const { d, checkIns } = deps()
    const boom = cronRoute(
      '/api/cron/keepalive',
      async () => {
        throw new Error('boom')
      },
      d,
    )
    await expect(boom(req('Bearer s3cret'))).rejects.toThrow('boom')
    expect(checkIns[1].checkIn.status).toBe('error')
  })

  it('runs an unscheduled route without a monitor', async () => {
    const { d, checkIns } = deps()
    const res = await cronRoute(
      '/api/cron/project-graph',
      async () => new Response('ok'),
      d,
    )(req('Bearer s3cret'))
    expect(res.status).toBe(200)
    expect(checkIns).toHaveLength(0)
  })
})
