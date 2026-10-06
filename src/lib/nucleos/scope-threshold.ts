// What a covered commodity code leaves unsaid: a small importer may be exempt.
//
// The EU exempts an importer whose iron and steel, aluminium, fertiliser and
// cement imports total 50 tonnes or less in a calendar year (EU 2023/956
// Art. 2a, from 1 January 2026; hydrogen and electricity are outside it). The
// UK applies CBAM from £50,000 of CBAM goods in 12 months (GOV.UK, "Work out
// the date you'll need to register for CBAM"). Neither can be judged from one
// commodity code, so the scope check answers "covered" and this states the
// threshold for the regime the organisation files under. It never says the
// goods are exempt: that is the importer's own total to check.
//
// Nucleos reports the EU threshold as a `de_minimis:` reason. The UK figure is
// HMRC's registration threshold, which is not part of the EU scope rules
// Nucleos evaluates, so it is stated here.
import type { CbamJurisdiction } from './jurisdiction'

const EU_THRESHOLD =
  'You are exempt only if all the iron and steel, aluminium, fertiliser and cement goods you import ' +
  'in a calendar year come to 50 tonnes or less in total. One commodity code cannot show that, so ' +
  'check your yearly total.'
const EU_NO_THRESHOLD =
  'The 50-tonne yearly exemption does not cover hydrogen or electricity. These goods are covered at any quantity.'
const UK_THRESHOLD =
  'CBAM applies once you have imported £50,000 or more of CBAM goods in the previous 12 months, or ' +
  'expect to in the next 30 days. Below that, you do not need to register with HMRC.'
const UK_NO_ELECTRICITY = 'UK CBAM does not cover electricity.'

export function scopeThresholdNotes({
  reasons,
  jurisdiction,
}: {
  reasons: readonly string[]
  jurisdiction: CbamJurisdiction
}): string[] {
  const threshold = reasons.find(r => r.trim().startsWith('de_minimis:annual_mass_threshold'))
  const none = reasons.find(r => r.trim().startsWith('de_minimis:not_available'))
  // Neither reason means the code is not covered, and there is nothing to qualify.
  if (!threshold && !none) return []

  const uk = none?.includes('not_available:electricity') ? UK_NO_ELECTRICITY : UK_THRESHOLD
  const eu = threshold ? EU_THRESHOLD : EU_NO_THRESHOLD

  if (jurisdiction === 'UK') return [uk]
  if (jurisdiction === 'EU') return [eu]
  return [`UK: ${uk}`, `EU: ${eu}`]
}
