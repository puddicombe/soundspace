import { Suspense } from 'react'

// Required by Next.js 14: any page using useSearchParams() must have a
// Suspense boundary in its tree to allow static build analysis to succeed.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}</Suspense>
}
