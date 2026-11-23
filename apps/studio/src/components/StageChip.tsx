import { STAGES, type Stage } from '@pave/schema'
import { Chip, cn, Menu, MenuRadioGroup, MenuRadioItem, ProgressRing } from '@pave/ui'
import { ChevronDown } from 'lucide-react'
import { STAGE_LABEL, STAGE_STEPS, stageStep } from '../lib/domain'

export function StageIcon({ stage, className }: { stage: Stage; className?: string }) {
  return (
    <ProgressRing
      step={stageStep(stage)}
      of={STAGE_STEPS}
      dashed={stage === 'idea'}
      className={cn(stage === 'done' ? 'text-ok' : 'text-fg-muted', className)}
    />
  )
}

export function StageChip({ stage }: { stage: Stage }) {
  return (
    <Chip icon={<StageIcon stage={stage} className="size-3!" />} className="text-fg">
      {STAGE_LABEL[stage]}
    </Chip>
  )
}

/** A stage chip that opens a menu to change the stage. */
export function StagePicker({ stage, onChange }: { stage: Stage; onChange: (s: Stage) => void }) {
  return (
    <Menu
      trigger={
        <button
          type="button"
          aria-label={`Stage: ${STAGE_LABEL[stage]}`}
          className="group inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-sm text-fg hover:bg-bg-hover data-popup-open:bg-bg-active"
        >
          <StageIcon stage={stage} />
          {STAGE_LABEL[stage]}
          <ChevronDown className="hover-reveal size-3 text-fg-subtle" aria-hidden />
        </button>
      }
      className="min-w-44"
    >
      <MenuRadioGroup value={stage} onChange={onChange}>
        {STAGES.map((s) => (
          <MenuRadioItem key={s} value={s}>
            <span className="flex items-center gap-2">
              <StageIcon stage={s} />
              {STAGE_LABEL[s]}
            </span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </Menu>
  )
}
