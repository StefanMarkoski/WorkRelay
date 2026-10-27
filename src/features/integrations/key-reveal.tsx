import { KeyRound } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { BorderBeam } from '@/components/ui/border-beam'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/common/copy-button'
import { functionsBaseUrl } from './queries'

/** Shown exactly once: after this the plaintext key cannot be recovered, only rotated. */
export function KeyRevealModal({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  return (
    <Modal open={secret !== null} onClose={onClose} title="Your WorkRelay secret key">
      {secret && (
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-lg border bg-muted p-3">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 shrink-0 text-primary" />
              <code className="break-all font-mono text-xs">{secret}</code>
            </div>
            <BorderBeam size={80} duration={8} colorFrom="oklch(0.62 0.2 285)" colorTo="oklch(0.75 0.15 300)" />
          </div>
          <p className="text-sm text-muted-foreground">
            Copy this key now. It is shown only once and stored hashed. Paste it into your commerce app's WorkRelay
            settings; the app then binds itself to this connection by calling{' '}
            <code className="text-xs">{functionsBaseUrl()}/bind</code>.
          </p>
          <div className="flex justify-end gap-2">
            <CopyButton text={secret} label="Copy key" />
            <Button onClick={onClose}>I have saved it</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
