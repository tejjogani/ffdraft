import { buttonClass, EmptyState, InlineError } from '@pave/ui'
import { type ErrorComponentProps, Link } from '@tanstack/react-router'
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

/** A route that threw: a quiet line with retry, not a crash screen. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  return (
    <div className="mx-auto w-full max-w-[880px] px-6 pt-16 sm:px-12">
      <InlineError
        message={
          error instanceof Error && error.message
            ? error.message
            : 'Something went wrong on this page.'
        }
        onRetry={reset}
      />
    </div>
  )
}
