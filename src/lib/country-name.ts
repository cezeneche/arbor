// An ISO 3166 country code as a name an importer reads: "TR" → "Turkey".
//
// Names come from the platform's own list (Intl.DisplayNames), so every
// country is covered without a table to maintain. Turkey is the one override:
// CLDR now says "Türkiye", while GOV.UK and HMRC's exchange-rate files say
// Turkey, and these screens sit beside HMRC's figures. A code that is not a
// country stays as it was rather than becoming "Unknown Region".

const UK_USAGE: Record<string, string> = { TR: 'Turkey' }

const names = new Intl.DisplayNames(['en-GB'], { type: 'region' })

export function countryName(code: string): string {
  const iso = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(iso)) return code.trim()
  if (UK_USAGE[iso]) return UK_USAGE[iso]
  const name = names.of(iso)
  return name && name !== iso && name !== 'Unknown Region' ? name : iso
}
