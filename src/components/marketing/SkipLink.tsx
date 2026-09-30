// The first thing a keyboard user reaches: a way past the navigation. Hidden
// until it takes focus (styled by .mk-skip-link in marketing.css).

export const MAIN_CONTENT_ID = 'main-content'

export function SkipLink() {
  return (
    <a className="mk-skip-link" href={`#${MAIN_CONTENT_ID}`}>
      Skip to content
    </a>
  )
}
