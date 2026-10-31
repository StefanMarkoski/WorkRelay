import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/input'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { PageHeader } from '@/components/common/page-header'
import { ErrorState, TableSkeleton } from '@/components/common/states'
import { FailureRetentionCard } from '@/features/failures/retention'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDate, humanize } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'
import type { Member, OrgRole } from '@/types/db'

export function SettingsPage() {
  const { current, canManage, isOwner, userId, refresh } = useWorkspace()
  const qc = useQueryClient()
  const [orgName, setOrgName] = useState(current.name)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [memberError, setMemberError] = useState<string | null>(null)

  const members = useQuery({
    queryKey: ['members', current.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_members', { org: current.id })
      if (error) throw error
      return data as Member[]
    },
  })
  const reload = () => qc.invalidateQueries({ queryKey: ['members', current.id] })

  async function saveName(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('organizations').update({ name: orgName.trim() }).eq('id', current.id)
    if (error) return setMsg({ tone: 'error', text: errorMessage(error) })
    await refresh()
    setMsg({ tone: 'ok', text: 'Workspace updated.' })
  }

  async function addMember(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    setMemberError(null)
    const { error } = await supabase.rpc('add_member_by_email', {
      org: current.id, member_email: String(data.get('email')), member_role: String(data.get('role')),
    })
    if (error) return setMemberError(errorMessage(error))
    form.reset()
    void reload()
  }

  async function changeRole(userIdToChange: string, role: OrgRole) {
    setMemberError(null)
    const { error } = await supabase.from('memberships').update({ role }).eq('organization_id', current.id).eq('user_id', userIdToChange)
    if (error) setMemberError(errorMessage(error))
    void reload()
  }

  async function remove(userIdToRemove: string) {
    setMemberError(null)
    const { error } = await supabase.from('memberships').delete().eq('organization_id', current.id).eq('user_id', userIdToRemove)
    if (error) setMemberError(errorMessage(error))
    void reload()
  }

  return (
    <>
      <PageHeader title="Settings" description="Workspace details and who can access them." />
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Workspace</CardTitle></CardHeader>
          <CardBody>
            <form onSubmit={saveName} className="flex max-w-md items-end gap-2">
              <div className="flex-1">
                <Field label="Name">{(id) => <Input id={id} value={orgName} maxLength={120} disabled={!canManage} onChange={(e) => setOrgName(e.target.value)} />}</Field>
              </div>
              {canManage && <Button type="submit" disabled={!orgName.trim() || orgName === current.name}>Save</Button>}
            </form>
            {msg && <p role={msg.tone === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${msg.tone === 'error' ? 'text-destructive' : 'text-success'}`}>{msg.text}</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Members</CardTitle></CardHeader>
          {members.isLoading ? <TableSkeleton rows={3} /> : members.error ? <ErrorState onRetry={() => members.refetch()} /> : (
            <Table>
              <THead><tr><TH>Email</TH><TH>Role</TH><TH>Joined</TH><TH><span className="sr-only">Actions</span></TH></tr></THead>
              <tbody>
                {members.data!.map((m) => (
                  <TR key={m.user_id}>
                    <TD>{m.email}{m.user_id === userId && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</TD>
                    <TD>
                      {isOwner && m.user_id !== userId ? (
                        <Select aria-label={`Role for ${m.email}`} className="w-32" value={m.role} onChange={(e) => changeRole(m.user_id, e.target.value as OrgRole)}>
                          <option value="owner">Owner</option><option value="admin">Admin</option><option value="member">Member</option>
                        </Select>
                      ) : humanize(m.role)}
                    </TD>
                    <TD className="text-muted-foreground">{formatDate(m.created_at)}</TD>
                    <TD className="text-right">
                      {canManage && m.role !== 'owner' && m.user_id !== userId && (
                        <Button variant="ghost" size="sm" onClick={() => remove(m.user_id)}>Remove</Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
          {canManage && (
            <form onSubmit={addMember} className="flex flex-wrap items-end gap-2 border-t p-4">
              <div className="min-w-60 flex-1"><Field label="Add an existing user by email">{(id) => <Input id={id} name="email" type="email" required />}</Field></div>
              <div className="w-36"><Field label="Role">{(id) => <Select id={id} name="role" defaultValue="member"><option value="member">Member</option><option value="admin">Admin</option></Select>}</Field></div>
              <Button type="submit">Add member</Button>
            </form>
          )}
          {memberError && <p role="alert" className="px-4 pb-4 text-sm text-destructive">{memberError}</p>}
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">People must sign up first; invitation emails are not available yet.</p>
        </Card>

        <FailureRetentionCard orgId={current.id} canManage={canManage} />
      </div>
    </>
  )
}
