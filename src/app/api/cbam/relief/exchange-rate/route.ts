import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { getHmrcExchangeRate } from '@/lib/nucleos/relief-client'

// HMRC's exchange rate for a relief claim, for the form to fill in. Read-only
// reference data. A month Nucleos does not hold is said plainly, so the rate is
// typed from HMRC's published figures rather than guessed.

function monthOf(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export async function GET(request: Request) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const params = new URL(request.url).searchParams
  const currency = (params.get('currency') ?? '').trim().toUpperCase()
  const date = (params.get('date') ?? '').trim()
  if (!/^[A-Z]{3}$/.test(currency) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return NextResponse.json({ error: 'Give a three-letter currency and a date.' }, { status: 400 })
  }

  try {
    const rate = await getHmrcExchangeRate(currency, date)
    if (!rate) {
      return NextResponse.json({
        held: false,
        message: `HMRC’s ${currency} rate for ${monthOf(date)} is not held yet. Enter it from HMRC’s monthly exchange rates.`,
      })
    }
    return NextResponse.json({
      held: true,
      rate: rate.rate,
      label: `HMRC’s ${currency} rate for ${monthOf(rate.effectiveFrom)} (reference table ${rate.tableVersion})`,
    })
  } catch {
    return NextResponse.json(
      { error: 'The CBAM service could not be reached. Try again in a moment.' },
      { status: 502 },
    )
  }
}
