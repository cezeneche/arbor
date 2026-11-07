import { enquiryAlert, sendEnquiryAlert } from '../enquiry-alert'
import { renderSlack } from '@/lib/alerts/format'

// A new pilot or institutional enquiry is announced in Slack so it is not left
// unseen in the database. Only the organisation, the kind of enquiry and a link
// to the review page go to Slack; contact details stay in Arbor.

const ORIGINAL = { ...process.env }
afterEach(() => {
  process.env = { ...ORIGINAL }
})

const pilot = { kind: 'pilot' as const, orgName: 'Example Imports Ltd', detail: 'importer' }

describe('enquiryAlert', () => {
  // Expected: an update naming the organisation and kind, with the detail as a
  // fact and a button to the review page. Reason: the house style (contract/alerts).
  it('names the organisation and the kind of enquiry, and links to the review page', () => {
    expect(enquiryAlert(pilot, 'https://arbor.test')).toEqual({
      severity: 'info',
      title: 'New pilot enquiry from Example Imports Ltd',
      summary: 'Their contact details and message are on the review page.',
      facts: [{ label: 'Details', value: 'importer' }],
      link: { label: 'Review the enquiry', url: 'https://arbor.test/admin/enquiries' },
    })
  })

  it('leaves out an empty detail', () => {
    const alert = enquiryAlert({ kind: 'institutional', orgName: 'Uni', detail: '' }, 'https://arbor.test')
    expect(alert.title).toBe('New institutional enquiry from Uni')
    expect(alert.facts).toEqual([])
  })
})

describe('sendEnquiryAlert', () => {
  it('does nothing until a webhook is configured', async () => {
    delete process.env.ENQUIRY_SLACK_WEBHOOK_URL
    const fetchImpl = jest.fn()
    await expect(sendEnquiryAlert(pilot, fetchImpl as unknown as typeof fetch)).resolves.toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // Expected: the house-style payload, posted to the enquiries webhook.
  it('posts the formatted message to the enquiries webhook', async () => {
    process.env.ENQUIRY_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/x'
    process.env.NEXT_PUBLIC_APP_URL = 'https://arbor.test'
    const fetchImpl = jest.fn(async () => new Response('ok', { status: 200 }))
    await expect(sendEnquiryAlert(pilot, fetchImpl as unknown as typeof fetch)).resolves.toBe(true)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://hooks.slack.test/x')
    const body = JSON.parse(String(init.body)) as ReturnType<typeof renderSlack>
    expect(body.text).toBe('Update: New pilot enquiry from Example Imports Ltd')
    expect(JSON.stringify(body.blocks)).toContain('https://arbor.test/admin/enquiries')
  })

  // Expected: a pasted contact detail never reaches Slack. Reason: contact
  // details stay in Arbor; only the organisation name is sent.
  it('sends no contact details', async () => {
    process.env.ENQUIRY_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/x'
    const fetchImpl = jest.fn(async () => new Response('ok', { status: 200 }))
    await sendEnquiryAlert(pilot, fetchImpl as unknown as typeof fetch)
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(init.body)).not.toMatch(/@|phone|email/i)
  })

  it('never throws: a failed alert must not fail the enquiry', async () => {
    process.env.ENQUIRY_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/x'
    const down = jest.fn(async () => {
      throw new Error('network')
    })
    await expect(sendEnquiryAlert(pilot, down as unknown as typeof fetch)).resolves.toBe(false)
    const refused = jest.fn(async () => new Response('no', { status: 403 }))
    await expect(sendEnquiryAlert(pilot, refused as unknown as typeof fetch)).resolves.toBe(false)
  })
})
