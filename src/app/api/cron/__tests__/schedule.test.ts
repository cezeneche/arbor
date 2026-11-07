/**
 * The cron schedule in vercel.json.
 *
 * A schedule entry whose route was deleted fails silently every run, so each
 * path must have a route. Entity resolution was unscheduled in the September
 * trim (#117) and turned back on in November: it proposes PENDING matches for
 * a person to confirm and never merges anything itself.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..', '..', '..', '..')
const crons: { path: string; schedule: string }[] = JSON.parse(
  readFileSync(join(ROOT, 'vercel.json'), 'utf8'),
).crons

it('every scheduled path has a route', () => {
  const missing = crons.map(c => c.path).filter(p => !existsSync(join(ROOT, 'src', 'app', p, 'route.ts')))
  expect(missing).toEqual([])
})

it('schedules entity resolution weekly, after calibration and the accuracy check', () => {
  expect(crons).toContainEqual({ path: '/api/cron/resolve-entities', schedule: '0 4 * * 1' })
})
