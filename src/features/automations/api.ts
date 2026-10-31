import { buildPresetDefinition, describePreset, shopIds, type PresetKind } from '@/domain/presets'
import { errorMessage, supabase } from '@/lib/supabase'

export interface AutomationRow {
  id: string
  name: string
  preset: PresetKind | null
  preset_config: Record<string, unknown> | null
  enabled: boolean
  status: 'draft' | 'published'
  current_version_id: string | null
  /** A hash of what makes the automation "the same" as another (set by the database; never the URL). */
  preset_key: string | null
  updated_at: string
}

export const AUTOMATION_COLUMNS = 'id, name, preset, preset_config, enabled, status, current_version_id, preset_key, updated_at'

async function publishError(error: unknown): Promise<string> {
  try {
    const body = await (error as { context?: Response }).context?.json()
    if (body?.issues) return (body.issues as { message: string }[]).map((i) => i.message).join('; ')
    if (body?.error === 'forbidden') return 'You do not have permission to change automations.'
    if (body?.error === 'unauthenticated') return `Your session has expired. Sign out and sign in again.${body.reason ? ` (${body.reason})` : ''}`
  } catch {
    // fall through
  }
  return 'Publishing failed. Please try again.'
}

/** What the shop choice looks like in a saved config: null for all shops, otherwise the ids in a fixed order. */
const shopKey = (config: unknown) => JSON.stringify([...(shopIds((config ?? {}) as { integration_ids?: string[]; integration_id?: string }) ?? ['*'])].sort())

/**
 * The database must hand back what was written. A save that was dropped (no rows changed) or that lost the chosen shops
 * would otherwise look like a success with an old label, so it is reported instead.
 */
export function assertSaved(rows: { preset_config: unknown }[] | null, sent: unknown): void {
  if (!rows || rows.length === 0) throw new Error('The automation could not be saved: nothing was changed. Reload the page and try again.')
  if (shopKey(rows[0].preset_config) !== shopKey(sent)) throw new Error('The chosen shops were not saved. Reload the page and try again.')
}

/**
 * Creates or updates an automation, publishes it as a new immutable version (validated on the server) and enables it.
 * If publishing fails, an edit is put back the way it was, so the saved settings never differ from what is running.
 * Throws an Error with a user-safe message.
 */
export async function saveAutomation(input: {
  organizationId: string
  id?: string
  kind: PresetKind
  config: unknown
  enable: boolean
}): Promise<void> {
  const built = buildPresetDefinition(input.kind, input.config)
  if (!built.ok) throw new Error(built.issues.join('; '))
  const { title } = describePreset(input.kind, input.config as Record<string, unknown>)
  const fields = { name: title, preset_config: input.config, draft_definition: built.definition }

  let id = input.id
  let previous: { name: string; preset_config: unknown; draft_definition: unknown } | null = null
  if (id) {
    const before = await supabase.from('workflows').select('name, preset_config, draft_definition').eq('id', id).maybeSingle()
    if (before.error) throw new Error(errorMessage(before.error))
    previous = before.data as typeof previous
    const { data, error } = await supabase.from('workflows').update(fields).eq('id', id).select('preset_config')
    if (error) throw new Error(errorMessage(error))
    assertSaved(data as { preset_config: unknown }[] | null, input.config)
  } else {
    const { data, error } = await supabase
      .from('workflows')
      .insert({ organization_id: input.organizationId, preset: input.kind, ...fields })
      .select('id, preset_config')
      .single()
    if (error) throw new Error(errorMessage(error))
    assertSaved([data as { preset_config: unknown }], input.config)
    id = (data as { id: string }).id
  }

  const published = await supabase.functions.invoke('publish-workflow', { body: { workflow_id: id } })
  if (published.error) {
    const message = await publishError(published.error)
    if (previous) await supabase.from('workflows').update(previous).eq('id', id) // best effort: undo the half-saved edit
    throw new Error(message)
  }

  if (input.enable) {
    const { error } = await supabase.from('workflows').update({ enabled: true }).eq('id', id)
    if (error) throw new Error(errorMessage(error))
  }
}

export async function setAutomationEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('workflows').update({ enabled }).eq('id', id)
  if (error) throw new Error(errorMessage(error))
}
