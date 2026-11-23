import { Tabs } from '@pave/ui'
import { useNavigate } from '@tanstack/react-router'
import { Column, PageHeader, PageTitle } from '../../components/Page'
import { CutsSection } from './CutsSection'
import { MetalsSection } from './MetalsSection'
import { RingSizesSection } from './RingSizesSection'
import { StonesSection } from './StonesSection'
import { TemplatesSection } from './TemplatesSection'

export const LIBRARY_TABS = ['metals', 'stones', 'cuts', 'sizes', 'templates'] as const
export type LibraryTab = (typeof LIBRARY_TABS)[number]

const LABEL: Record<LibraryTab, string> = {
  metals: 'Metals',
  stones: 'Stones',
  cuts: 'Cuts',
  sizes: 'Ring sizes',
  templates: 'Templates',
}

const SECTIONS: Record<LibraryTab, () => React.ReactNode> = {
  metals: MetalsSection,
  stones: StonesSection,
  cuts: CutsSection,
  sizes: RingSizesSection,
  templates: TemplatesSection,
}

/** Reference data — the same numbers the CAD and production packages use. */
export function LibraryPage({ tab }: { tab: LibraryTab }) {
  const navigate = useNavigate()
  const Section = SECTIONS[tab]
  return (
    <>
      <PageHeader crumbs={[{ label: 'Library' }, { label: LABEL[tab] }]} />
      <Column wide>
        <PageTitle
          title="Library"
          description="Metals, stones, cuts and sizes — the numbers behind every piece."
        />
        <Tabs
          value={tab}
          onChange={(t) => void navigate({ to: '/library', search: { tab: t }, replace: true })}
          items={LIBRARY_TABS.map((t) => ({ value: t, label: LABEL[t] }))}
          className="mb-6"
        />
        <Section />
      </Column>
    </>
  )
}
