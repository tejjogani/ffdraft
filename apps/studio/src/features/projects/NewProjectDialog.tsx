import { TEMPLATES } from '@pave/schema'
import { Button, Dialog, InlineError, Input, Select } from '@pave/ui'
import { type HistoryState, useLocation, useNavigate, useRouter } from '@tanstack/react-router'
import { Folder, LayoutTemplate, Sparkles } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useRpc, useRpcMutation } from '../../lib/query'
import { useSession } from '../../lib/session'
import { useCurrentView } from '../../lib/use-current-view'
import { projectFolder } from './folder'

const folderIcon = <Folder className="size-4 shrink-0 text-fg-subtle" aria-hidden />
const templateIcon = <LayoutTemplate className="size-4 shrink-0 text-fg-subtle" aria-hidden />
const touch = 'pointer-coarse:min-h-11'
const templateOptions = [
  { value: '', label: 'Blank project', icon: templateIcon },
  ...TEMPLATES.map(({ id, spec }) => ({ value: id, label: spec.title, icon: templateIcon })),
]

export function NewProjectHost() {
  const draft = useLocation({ select: (location) => location.state.newProject })
  return draft ? <NewProjectDialog key={draft.requestId} draft={draft} /> : null
}

function NewProjectDialog({ draft }: { draft: NonNullable<HistoryState['newProject']> }) {
  const form = useId()
  const nameId = useId()
  const input = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const router = useRouter()
  const isCurrent = useCurrentView()
  const assistant = useSession().capabilities.assistant
  const [name, setName] = useState('')
  const [folder, setFolder] = useState(draft.collectionId ?? '')
  const [template, setTemplate] = useState(draft.templateId ?? null)
  const submitting = useRef(false)
  const create = useRpcMutation('pieces.create', { meta: { silent: true } })
  const collections = useRpc('collections.list', {})
  const folders = collections.data ?? []
  const title = name.trim()

  const folderOptions = [
    { value: '', label: projectFolder(null, folders), icon: folderIcon },
    ...folders.map(({ id }) => ({
      value: id,
      label: projectFolder(id, folders),
      icon: folderIcon,
    })),
  ]
  if (folder && !folders.some((entry) => entry.id === folder)) {
    folderOptions.push({
      value: folder,
      label: projectFolder(folder, collections.data),
      icon: folderIcon,
    })
  }

  const cancel = () => {
    if (!submitting.current) router.history.back()
  }

  const submit = async () => {
    if (!title || submitting.current) return
    submitting.current = true
    try {
      const piece = await create.mutateAsync({
        title,
        collectionId: folder || null,
        templateId: template || undefined,
        requestId: draft.requestId,
      })
      if (isCurrent())
        await navigate({ to: '/pieces/$id', params: { id: piece.id }, replace: true })
    } catch {
      // The mutation's error stays on the form alongside the draft.
    } finally {
      submitting.current = false
    }
  }

  const startIntake = () => {
    if (!title || submitting.current) return
    void navigate({
      to: '/',
      search: {},
      state: { projectIntake: { title, collectionId: folder || null } },
      replace: true,
    })
  }

  return (
    <Dialog
      open
      title="New project"
      initialFocus={input}
      onOpenChange={(open) => {
        if (!open) cancel()
      }}
      className="max-sm:top-4 max-sm:max-h-[calc(100dvh-2rem)]"
      footer={
        <>
          <Button variant="ghost" className={touch} disabled={create.isPending} onClick={cancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={form}
            variant="primary"
            className={touch}
            disabled={!title || create.isPending}
          >
            {create.isPending ? 'Creating…' : 'Create project'}
          </Button>
        </>
      }
    >
      <form
        id={form}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="space-y-3.5"
      >
        <label className="grid gap-1.5 text-sm font-medium" htmlFor={nameId}>
          Project name
          <Input
            ref={input}
            id={nameId}
            required
            maxLength={120}
            placeholder="e.g. Pearl drop earrings"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={create.isPending}
            className="h-9 font-normal pointer-coarse:min-h-11 pointer-coarse:text-base"
          />
        </label>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Folder</span>
          <Select
            aria-label="Folder"
            value={folder}
            onChange={setFolder}
            options={folderOptions}
            disabled={create.isPending}
            className={touch}
          />
        </div>
        {collections.isError && (
          <InlineError
            message="Couldn’t load folders."
            onRetry={() => void collections.refetch()}
          />
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Select
            aria-label="Template"
            variant="bare"
            placeholder="Choose a template"
            value={template}
            onChange={setTemplate}
            options={templateOptions}
            disabled={create.isPending}
            className={`${touch} [&>span>span]:text-fg-muted [&>svg]:opacity-100`}
          />
          {!template && (
            <Button
              variant="ghost"
              size="sm"
              className={touch}
              icon={Sparkles}
              onClick={startIntake}
              disabled={!title || create.isPending}
            >
              {assistant ? 'Design with AI' : 'Design from a brief'}
            </Button>
          )}
        </div>
        {create.error && <InlineError message={create.error.message} />}
      </form>
    </Dialog>
  )
}
