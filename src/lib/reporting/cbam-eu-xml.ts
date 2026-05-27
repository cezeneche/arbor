// Layer 3 — packaging only. No calculation logic.
// [EU Regulation 2023/1773 Annex I] CBAM XML submission format for EU registry

import type { CbamInput } from './cbam-uk'

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// [EU 2023/1773 Annex I] buildCbamEuXml — XML submission per EU CBAM registry format
export function buildCbamEuXml(input: CbamInput): string {
  const totalEmissions = input.declarations.reduce(
    (sum, d) => sum + d.embeddedEmissionsKgCo2e,
    0,
  )

  const declarationXml = input.declarations
    .map(
      (d) => `    <Declaration>
      <Reference>${escapeXml(d.declarationReference)}</Reference>
      <CommodityCode>${escapeXml(d.commodityCode)}</CommodityCode>
      <CommodityDescription>${escapeXml(d.commodityDescription)}</CommodityDescription>
      <CountryOfOrigin>${escapeXml(d.countryOfOrigin)}</CountryOfOrigin>
      <ImporterName>${escapeXml(d.importerName)}</ImporterName>
      <DeclaredWeight>${d.declaredWeight}</DeclaredWeight>
      <EmbeddedEmissionsKgCO2e>${d.embeddedEmissionsKgCo2e}</EmbeddedEmissionsKgCO2e>
      <CalculationTier>${escapeXml(d.calculationTier)}</CalculationTier>
      <TrustTier>${escapeXml(d.trustTier)}</TrustTier>
    </Declaration>`,
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<CBAMReturn xmlns="urn:eu:cbam:2023:1773" version="1.0">
  <Header>
    <EntityName>${escapeXml(input.entityName)}</EntityName>
    <ReportingPeriod>
      <Year>${input.year}</Year>
      <Quarter>${escapeXml(input.quarter)}</Quarter>
    </ReportingPeriod>
    <RegulatoryBasis>EU Regulation 2023/1773 Annex I</RegulatoryBasis>
  </Header>
  <Declarations>
${declarationXml}
  </Declarations>
  <Summary>
    <TotalDeclarations>${input.declarations.length}</TotalDeclarations>
    <TotalEmbeddedEmissionsKgCO2e>${totalEmissions}</TotalEmbeddedEmissionsKgCO2e>
  </Summary>
</CBAMReturn>`
}
