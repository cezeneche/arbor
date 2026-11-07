// The one format for every Slack message and operations email. Pure: no network.
//
// The rules, and the golden cases this is tested against, live in
// contract/alerts/ and are shared with Nucleos's renderer, so a message looks the
// same whichever system sends it. Change the golden file first.
import { escapeHtml } from '@/lib/email/client'

export type AlertSeverity = 'critical' | 'warning' | 'info' | 'resolved'

export interface Alert {
  severity: AlertSeverity
  /** The system that raised it: 'Arbor', 'Nucleos'. */
  source: string
  environment: string
  /** What is wrong or what happened: a short sentence, sentence case, no full stop. */
  title: string
  /** One or two plain sentences: what happened and what it affects. */
  summary: string
  facts?: { label: string; value: string }[]
  /** What to do next, as one instruction. */
  action?: string
  /** The one place to act. Only http(s) links are shown. */
  link?: { label: string; url: string }
  /** Something to search logs by: run ID, issue ID, cron path. */
  ref?: string
  at: Date
}

const SEVERITY: Record<AlertSeverity, { label: string; marker: string }> = {
  critical: { label: 'Action needed', marker: ':red_circle:' },
  warning: { label: 'Warning', marker: ':large_orange_circle:' },
  info: { label: 'Update', marker: ':large_blue_circle:' },
  resolved: { label: 'Resolved', marker: ':large_green_circle:' },
}

const MAX_TITLE = 150
const MAX_SUMMARY = 1500
const MAX_FACT = 500
const MAX_FACTS = 10 // Slack's limit on fields in one section
const MAX_BUTTON = 75

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Cut by characters (code points), as Python does, so both sides cut alike. */
function cut(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length <= max ? value : chars.slice(0, max - 1).join('') + '…'
}

/** Slack's three control characters; stops outside text pinging @channel or forging links. */
function slackEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function utc(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`
}

function safeLink(link: Alert['link']): Alert['link'] {
  if (!link || !/^https?:\/\//i.test(link.url)) return undefined
  return { label: cut(link.label, MAX_BUTTON), url: link.url }
}

/** The alert with every limit applied: what both renderers actually show. */
function normalise(alert: Alert) {
  return {
    ...SEVERITY[alert.severity],
    source: alert.source,
    environment: alert.environment,
    title: cut(alert.title, MAX_TITLE),
    summary: cut(alert.summary, MAX_SUMMARY),
    facts: (alert.facts ?? []).slice(0, MAX_FACTS).map(f => ({
      label: cut(f.label, MAX_FACT),
      value: cut(f.value, MAX_FACT),
    })),
    action: alert.action ? cut(alert.action, MAX_SUMMARY) : undefined,
    link: safeLink(alert.link),
    ref: alert.ref,
    when: utc(alert.at),
  }
}

type Block = Record<string, unknown>

export function renderSlack(alert: Alert): { text: string; blocks: Block[] } {
  const a = normalise(alert)
  const mrkdwn = (text: string) => ({ type: 'mrkdwn', text })

  const blocks: Block[] = [
    { type: 'context', elements: [mrkdwn(`${a.marker} *${a.label}* · ${a.source} · ${a.environment}`)] },
    { type: 'section', text: mrkdwn(`*${slackEscape(a.title)}*\n${slackEscape(a.summary)}`) },
  ]
  if (a.facts.length > 0) {
    blocks.push({
      type: 'section',
      fields: a.facts.map(f => mrkdwn(`*${slackEscape(f.label)}*\n${slackEscape(f.value)}`)),
    })
  }
  if (a.action) {
    blocks.push({ type: 'section', text: mrkdwn(`*What to do*\n${slackEscape(a.action)}`) })
  }
  if (a.link) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: a.link.label, emoji: false },
          url: a.link.url,
          style: 'primary',
        },
      ],
    })
  }
  const ref = a.ref ? ` · ref \`${slackEscape(a.ref)}\`` : ''
  blocks.push({ type: 'context', elements: [mrkdwn(`${a.when}${ref}`)] })

  return { text: `${a.label}: ${slackEscape(a.title)}`, blocks }
}

export function renderEmail(alert: Alert): { subject: string; text: string; html: string } {
  const a = normalise(alert)
  const env = a.environment === 'production' ? '' : ` ${a.environment}`
  const ref = a.ref ? ` · ref ${a.ref}` : ''

  const text: string[] = [`${a.label} · ${a.source} · ${a.environment}`, `${a.title}\n${a.summary}`]
  const html: string[] = [
    `<p><strong>${a.label}</strong> · ${escapeHtml(a.source)} · ${escapeHtml(a.environment)}</p>`,
    `<p><strong>${escapeHtml(a.title)}</strong><br>${escapeHtml(a.summary)}</p>`,
  ]
  if (a.facts.length > 0) {
    text.push(a.facts.map(f => `${f.label}: ${f.value}`).join('\n'))
    const items = a.facts.map(f => `<li><strong>${escapeHtml(f.label)}:</strong> ${escapeHtml(f.value)}</li>`)
    html.push(`<ul>${items.join('')}</ul>`)
  }
  if (a.action) {
    text.push(`What to do: ${a.action}`)
    html.push(`<p><strong>What to do:</strong> ${escapeHtml(a.action)}</p>`)
  }
  if (a.link) {
    text.push(`${a.link.label}: ${a.link.url}`)
    html.push(`<p><a href="${escapeHtml(a.link.url)}">${escapeHtml(a.link.label)}</a></p>`)
  }
  text.push(`${a.when}${ref}`)
  html.push(`<p>${a.when}${escapeHtml(ref)}</p>`)

  return {
    subject: `[${a.source}${env}] ${a.label}: ${a.title}`,
    text: text.join('\n\n'),
    html: html.join('\n'),
  }
}
