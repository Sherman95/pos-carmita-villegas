export const POS_ROLES = ['owner', 'admin', 'reception', 'professional'] as const;
export type PosRole = typeof POS_ROLES[number];
export type StoredPosRole = PosRole | 'user';

export const PERMISSIONS = {
  appointmentsRead: 'appointments.read',
  appointmentsReadOwn: 'appointments.read_own',
  appointmentsCreate: 'appointments.create',
  appointmentsUpdate: 'appointments.update',
  appointmentsUpdateOwn: 'appointments.update_own',
  appointmentsCancel: 'appointments.cancel',
  appointmentsForce: 'appointments.force',
  sidroManage: 'sidro_requests.manage',
  sidroManageOwn: 'sidro_requests.manage_own',
  schedulesManage: 'schedules.manage',
  schedulesManageOwn: 'schedules.manage_own',
  clientsRead: 'clients.read',
  clientsCreate: 'clients.create',
  clientsUpdate: 'clients.update',
  clientsDelete: 'clients.delete',
  employeesRead: 'employees.read',
  employeesManage: 'employees.manage',
  catalogRead: 'catalog.read',
  catalogManage: 'catalog.manage',
  salesRead: 'sales.read',
  salesCreate: 'sales.create',
  paymentsCreate: 'payments.create',
  cashOperate: 'cash.operate',
  cashHistory: 'cash.history',
  cashSettingsManage: 'cash.settings.manage',
  expensesManage: 'expenses.manage',
  reportsRead: 'reports.read',
  usersRead: 'users.read',
  usersCreate: 'users.create',
  usersUpdate: 'users.update',
  usersResetPassword: 'users.reset_password',
  usersRevokeSessions: 'users.revoke_sessions',
  rolesManage: 'roles.manage',
  auditRead: 'audit.read',
  integrationsManage: 'integrations.manage',
  sidroAccountsLink: 'sidro_accounts.link',
  sidroServicesConfigure: 'sidro_services.configure',
  businessSettingsManage: 'business_settings.manage',
  profilePasswordChange: 'profile.password.change'
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

const common = [PERMISSIONS.employeesRead, PERMISSIONS.catalogRead, PERMISSIONS.profilePasswordChange];

const matrix: Record<PosRole, ReadonlySet<Permission>> = {
  owner: new Set(Object.values(PERMISSIONS)),
  admin: new Set([
    ...common,
    PERMISSIONS.appointmentsRead, PERMISSIONS.appointmentsCreate, PERMISSIONS.appointmentsUpdate,
    PERMISSIONS.appointmentsCancel, PERMISSIONS.appointmentsForce,
    PERMISSIONS.sidroManage, PERMISSIONS.schedulesManage,
    PERMISSIONS.clientsRead, PERMISSIONS.clientsCreate, PERMISSIONS.clientsUpdate, PERMISSIONS.clientsDelete,
    PERMISSIONS.employeesManage, PERMISSIONS.catalogManage,
    PERMISSIONS.salesRead, PERMISSIONS.salesCreate, PERMISSIONS.paymentsCreate,
    PERMISSIONS.cashOperate, PERMISSIONS.cashHistory,
    PERMISSIONS.expensesManage, PERMISSIONS.reportsRead,
    PERMISSIONS.usersRead, PERMISSIONS.usersCreate, PERMISSIONS.usersUpdate,
    PERMISSIONS.usersResetPassword, PERMISSIONS.usersRevokeSessions, PERMISSIONS.auditRead,
    PERMISSIONS.sidroAccountsLink
  ]),
  reception: new Set([
    ...common,
    PERMISSIONS.appointmentsRead, PERMISSIONS.appointmentsCreate, PERMISSIONS.appointmentsUpdate,
    PERMISSIONS.appointmentsCancel, PERMISSIONS.sidroManage,
    PERMISSIONS.clientsRead, PERMISSIONS.clientsCreate, PERMISSIONS.clientsUpdate,
    PERMISSIONS.salesRead, PERMISSIONS.salesCreate, PERMISSIONS.paymentsCreate,
    PERMISSIONS.cashOperate
  ]),
  professional: new Set([
    ...common,
    PERMISSIONS.appointmentsReadOwn, PERMISSIONS.appointmentsUpdateOwn,
    PERMISSIONS.sidroManageOwn, PERMISSIONS.schedulesManageOwn
  ])
};

// `user` solo existe para que cuentas heredadas sigan autenticando hasta que
// el propietario clasifique explícitamente cada una.
export const canonicalRole = (role: unknown): PosRole | null => {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'user') return 'professional';
  return (POS_ROLES as readonly string[]).includes(value) ? value as PosRole : null;
};

export const permissionsForRole = (role: unknown): Permission[] => {
  const canonical = canonicalRole(role);
  return canonical ? [...matrix[canonical]] : [];
};

export const roleHasPermission = (role: unknown, permission: Permission): boolean =>
  permissionsForRole(role).includes(permission);

export const canManageRole = (actorRole: unknown, targetRole: unknown): boolean => {
  const actor = canonicalRole(actorRole);
  const target = canonicalRole(targetRole);
  if (!actor || !target) return false;
  if (actor === 'owner') return true;
  return actor === 'admin' && (target === 'reception' || target === 'professional');
};

export const assignableRoles = (actorRole: unknown): PosRole[] => {
  const actor = canonicalRole(actorRole);
  if (actor === 'owner') return [...POS_ROLES];
  if (actor === 'admin') return ['reception', 'professional'];
  return [];
};

