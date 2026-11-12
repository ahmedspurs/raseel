/**
 * Role-based access control shared by the API and the web app.
 * Roles are ordered from most to least privileged (SRS §2.2).
 */
export const ROLES = ['OWNER', 'ADMIN', 'AGENT', 'VIEWER'] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS = [
  'settings:manage',
  'whatsapp:manage',
  'data:export',
  'users:manage',
  'teams:manage',
  'templates:manage',
  'automations:manage',
  'tags:manage',
  'reports:view',
  'conversations:view',
  'conversations:reply',
  'conversations:assign',
  'contacts:view',
  'contacts:edit',
  'notes:write',
  'deals:edit',
  'audit:view',
] as const
export type Permission = (typeof PERMISSIONS)[number]

const VIEWER: readonly Permission[] = ['conversations:view', 'contacts:view', 'reports:view']

const AGENT: readonly Permission[] = [
  ...VIEWER,
  'conversations:reply',
  'conversations:assign',
  'contacts:edit',
  'notes:write',
  'deals:edit',
]

const ADMIN: readonly Permission[] = [
  ...AGENT,
  'users:manage',
  'teams:manage',
  'templates:manage',
  'automations:manage',
  'tags:manage',
  'audit:view',
]

const OWNER: readonly Permission[] = [...PERMISSIONS]

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(OWNER),
  ADMIN: new Set(ADMIN),
  AGENT: new Set(AGENT),
  VIEWER: new Set(VIEWER),
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission)
}

/** Lower number = more privileged. */
export function roleRank(role: Role): number {
  return ROLES.indexOf(role)
}

/**
 * A user may only grant or change roles strictly below their own,
 * except the Owner, who may grant any role except a second Owner.
 */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (target === 'OWNER') return false
  if (actor === 'OWNER') return true
  return roleRank(actor) < roleRank(target)
}
