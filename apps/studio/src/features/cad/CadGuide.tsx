import { Button, Dialog, DialogClose } from '@pave/ui'
import { useRef, useState } from 'react'
import guide from '../../../../../docs/first-time-cad.md?raw'

// Each level-two heading starts a step. The introduction is only for the standalone guide.
const steps = guide
  .split(/^##[ \t]+/m)
  .slice(1)
  .map((section) => {
    const [title = '', ...lines] = section.trim().split(/\r?\n/)
    const paragraphs = lines
      .join('\n')
      .trim()
      .split(/\n(?:[ \t]*\n)+/)
    return { title: title.trim(), paragraphs }
  })

export function CadGuide() {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const heading = useRef<HTMLDivElement>(null)
  const step = steps[index]
  if (!step) return null
  const last = index === steps.length - 1
  const showStep = (stepIndex: number) => {
    heading.current?.scrollIntoView({ block: 'nearest' })
    setIndex(stepIndex)
  }

  return (
    <Dialog
      title="CAD guide"
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) showStep(0)
        setOpen(nextOpen)
      }}
      trigger={<Button size="sm">CAD guide</Button>}
      className="h-[36rem]"
      footer={
        <>
          <DialogClose
            render={
              <Button variant="ghost" className="mr-auto">
                Close
              </Button>
            }
          />
          <Button disabled={index === 0} onClick={() => showStep(index - 1)}>
            Back
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (last) setOpen(false)
              else showStep(index + 1)
            }}
          >
            {last ? 'Done' : 'Next'}
          </Button>
        </>
      }
    >
      <div ref={heading} aria-live="polite" aria-atomic="true">
        <p className="text-xs text-fg-muted">
          Step {index + 1} of {steps.length}
        </p>
        <h3 className="mt-1 text-sm font-medium">{step.title}</h3>
      </div>
      <div className="mt-2 space-y-2 text-sm text-fg-muted">
        {step.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </Dialog>
  )
}
