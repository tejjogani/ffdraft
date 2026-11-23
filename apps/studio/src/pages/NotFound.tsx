import { buttonClass, EmptyState } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { PageHeader } from '../components/Page'

export function NotFound() {
  return (
    <>
      <PageHeader crumbs={[{ label: 'Not found' }]} />
      <EmptyState
        className="mt-[12vh]"
        title="Nothing here"
        description="This page doesn’t exist, or it was moved."
        action={
          <Link to="/" className={buttonClass()}>
            Go home
          </Link>
        }
      />
    </>
  )
}
