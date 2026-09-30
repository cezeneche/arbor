export function LegalContents({ sections }: { sections: { id: string; label: string }[] }) {
  return <nav aria-label="Document contents" className="mk-legal-contents"><strong>On this page</strong><div>{sections.map(section => <a href={`#${section.id}`} key={section.id}>{section.label}</a>)}</div></nav>
}
