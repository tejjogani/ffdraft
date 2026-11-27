import { buildDesign, METALS, TEMPLATES } from '@pave/schema'
import { Button, Chip, Swatch } from '@pave/ui'
import { KindGlyph } from '../../components/KindGlyph'
import { useOpenNewProject } from '../../features/projects/new-project'

export function TemplatesSection() {
  const openNewProject = useOpenNewProject()
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {TEMPLATES.map((t) => {
        const metal = METALS[t.spec.metal?.alloy ?? 'au18k-yellow']
        return (
          <article
            key={t.id}
            className="group flex flex-col overflow-hidden rounded-lg shadow-[0_0_0_1px_var(--line)]"
          >
            <div className="stage flex aspect-[16/9] items-center justify-center">
              <KindGlyph kind={buildDesign(t.spec).kind} className="w-20 text-fg-muted" />
            </div>
            <div className="flex flex-1 flex-col p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-medium">{t.spec.title}</h3>
                <Chip>{t.family}</Chip>
              </div>
              <p className="mt-1 line-clamp-2 flex-1 text-xs text-fg-muted">{t.spec.summary}</p>
              <div className="mt-4 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
                  <Swatch color={metal.swatch} kind="metal" size="sm" />
                  {metal.label}
                </span>
                <Button size="sm" onClick={() => openNewProject({ templateId: t.id })}>
                  Use template
                </Button>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
