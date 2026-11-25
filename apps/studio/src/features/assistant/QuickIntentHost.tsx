/**
 * The one place the quick-intent dialogs live, in the app shell: a menu row anywhere (feature
 * tree, viewport, later a piece card) hands over its subject and closes; the dialog opens here
 * with the piece's live session if the design is open, or works through the server if not.
 */
import { useLiveSession } from '../../lib/design-session/store'
import { usePieceDesign } from './AskAiSection'
import { type StoneSubject, useQuickIntent } from './quick-intent-store'
import { ReplaceStoneDialog } from './ReplaceStoneDialog'

export function QuickIntentHost() {
  const replacing = useQuickIntent((s) => s.replacing)
  return replacing ? <ReplaceHost key={JSON.stringify(replacing)} subject={replacing} /> : null
}

function ReplaceHost({ subject }: { subject: StoneSubject }) {
  const session = useLiveSession(subject.pieceId)
  const design = usePieceDesign(subject.pieceId)
  if (!design) return null
  return (
    <ReplaceStoneDialog
      subject={subject}
      design={design}
      session={session}
      onClose={() => useQuickIntent.getState().close()}
    />
  )
}
