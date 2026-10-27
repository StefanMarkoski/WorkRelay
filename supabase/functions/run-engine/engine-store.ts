import type { SupabaseClient } from '@supabase/supabase-js'
import type { EngineStore, RunRow } from '../_shared/engine.ts'

const UNIQUE_VIOLATION = '23505'

export function createEngineStore(db: SupabaseClient): EngineStore {
  return {
    async claimRuns(limit, leaseSeconds) {
      const { data, error } = await db.rpc('claim_runs', { p_limit: limit, p_lease_seconds: leaseSeconds })
      if (error) throw new Error(error.message)
      return (data ?? []) as RunRow[]
    },

    async sweepTimeouts() {
      const { data, error } = await db.rpc('sweep_run_timeouts')
      if (error) throw new Error(error.message)
      return (data as number) ?? 0
    },

    async loadDefinition(versionId) {
      const { data, error } = await db.from('workflow_versions').select('definition').eq('id', versionId).single()
      if (error) throw new Error(error.message)
      return data.definition
    },

    async countStepRuns(runId) {
      const { count, error } = await db.from('step_runs').select('id', { count: 'exact', head: true }).eq('run_id', runId)
      if (error) throw new Error(error.message)
      return count ?? 0
    },

    async insertStepRun(r) {
      const { error } = await db.from('step_runs').insert({
        organization_id: r.organizationId, run_id: r.runId, step_key: r.stepKey, step_name: r.stepName,
        step_type: r.stepType, position: r.position, status: r.status, input: r.input, output: r.output,
        error: r.error, attempt: r.attempt, started_at: r.startedAt, finished_at: r.finishedAt,
      })
      if (error) throw new Error(error.message)
    },

    async getApproval(runId, stepKey) {
      const { data, error } = await db.from('approvals').select('status').eq('run_id', runId).eq('step_key', stepKey).maybeSingle()
      if (error) throw new Error(error.message)
      return data as { status: 'pending' | 'approved' | 'rejected' } | null
    },

    async createApproval(a) {
      const { error } = await db.from('approvals').insert({
        organization_id: a.organizationId, run_id: a.runId, step_key: a.stepKey, title: a.title,
        reviewer_role: a.reviewerRole, context: a.context,
      })
      // The (run, step) unique index makes a crashed-and-retried step idempotent.
      if (error && error.code !== UNIQUE_VIOLATION) throw new Error(error.message)
    },

    async saveRun(runId, patch) {
      const row: Record<string, unknown> = { ...patch }
      if (patch.status && patch.status !== 'running') row.locked_until = null
      const { data, error } = await db.from('workflow_runs').update(row).eq('id', runId).eq('status', 'running').select('id')
      if (error) throw new Error(error.message)
      return (data?.length ?? 0) > 0
    },
  }
}
