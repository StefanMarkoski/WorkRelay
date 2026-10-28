import { buildPresetDefinition, describePreset, type PresetKind } from '@/domain/presets'
import { errorMessage, supabase } from '@/lib/supabase'

export interface AutomationRow {
  id: string
  name: string
  preset: PresetKind | null
  preset_config: Record<string, unknown> | null
  enabled: boolean
  status: 'draft' | 'published'
  current_version_id: string | null
  updated_at: string
}

export const AUTOMATION_COLUMNS = 'id, name, preset, preset_config, enabled, status, current_version_id, updated_at'

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

/**
 * Creates or updates an automation, publishes it as a new immutable version (validated on the server) and enables it.
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
  if (id) {
    const { error } = await supabase.from('workflows').update(fields).eq('id', id)
    if (error) throw new Error(errorMessage(error))
  } else {
    const { data, error } = await supabase
      .from('workflows')
      .insert({ organization_id: input.organizationId, preset: input.kind, ...fields })
      .select('id')
      .single()
    if (error) throw new Error(errorMessage(error))
    id = data.id as string
  }

  const published = await supabase.functions.invoke('publish-workflow', { body: { workflow_id: id } })
  if (published.error) throw new Error(await publishError(published.error))

  if (input.enable) {
    const { error } = await supabase.from('workflows').update({ enabled: true }).eq('id', id)
    if (error) throw new Error(errorMessage(error))
  }
}

export async function setAutomationEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('workflows').update({ enabled }).eq('id', id)
  if (error) throw new Error(errorMessage(error))
}
