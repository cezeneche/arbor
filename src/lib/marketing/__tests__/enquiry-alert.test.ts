import { enquiryAlertText, sendEnquiryAlert } from '../enquiry-alert'

// A new pilot or institutional enquiry is announced in Slack so it is not left
// unseen in the database. Only the organisation, the kind of enquiry and a link
// to the review page go to Slack; contact details stay in Arbor.

const ORIGINAL = { ...process.env }
afterEach(() => {
  process.env = { ...ORIGINAL }
})

const pilot = { kind: 'pilot' as const, orgName: 'Example Imports Ltd', detail: 'importer' }

describe('enquiryAlertText', () => {
  it('names the organisation and the kind of enquiry, and links to the review page', () => {
    expect(enquiryAlertText(pilot, 'https://arbor.test')).toBe(
      'New pilot enquiry from Example Imports Ltd (importer). Review it: https://arbor.test/admin/enquiries',
    )
  })

  it('leaves out an empty detail', () => {
    expect(enquiryAlertText({ kind: 'institutional', orgName: 'Uni', detail: '' }, 'https://arbor.test')).toBe(
      'New institutional enquiry from Uni. Review it: https://arbor.test/admin/enquiries',
    )
  })
})

describe('sendEnquiryAlert', () => {
  it('does nothing until a webhook is configured', async () => {
    delete process.env.ENQUIRY_SLACK_WEBHOOK_URL
    const fetchImpl = jest.fn()
    await expect(sendEnquiryAlert(pilot, fetchImpl as unknown as typeof fetch)).resolves.toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('posts the text to the webhook', async () => {
    process.env.ENQUIRY_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/x'
    process.env.NEXT_PUBLIC_APP_URL = 'https://arbor.test'
    const fetchImpl = jest.fn(async () => new Response('ok', { status: 200 }))
    await expect(sendEnquiryAlert(pilot, fetchImpl as unknown as typeof fetch)).resolves.toBe(true)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://hooks.slack.test/x')
    expect(JSON.parse(String(init.body))).toEqual({
      text: 'New pilot enquiry from Example Imports Ltd (importer). Review it: https://arbor.test/admin/enquiries',
    })
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
