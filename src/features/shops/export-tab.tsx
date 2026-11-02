import { ExportAccess } from '@/features/integrations/export-access'
import type { Integration } from '@/types/db'

/** Letting this shop read its own data back. */
export function ExportTab({ shop }: { shop: Integration }) {
  return (
    <div className="max-w-3xl">
      <ExportAccess shop={shop} />
    </div>
  )
}
