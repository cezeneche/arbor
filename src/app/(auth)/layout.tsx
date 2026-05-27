import { colours } from '@/lib/design-system'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colours.background,
        padding: '24px',
      }}
    >
      {children}
    </div>
  )
}
