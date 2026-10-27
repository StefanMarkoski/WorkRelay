import { z } from 'zod'

/** Input for creating a tenant (workspace + its first owner login). The password is never stored or logged by WorkRelay. */
export const createTenantSchema = z.object({
  org_name: z.string().trim().min(1, 'Enter a workspace name').max(120),
  email: z.email('Enter a valid email').max(320),
  // 72 is bcrypt's input limit, which the auth service applies.
  password: z.string().min(10, 'Use at least 10 characters').max(72, 'Use at most 72 characters'),
})

export type CreateTenantInput = z.infer<typeof createTenantSchema>
