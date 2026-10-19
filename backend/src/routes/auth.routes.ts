import { Router } from 'express';
import {
  adminResetPassword, changeOwnPassword, completePosPasswordReset, createUser,
  getAdminAuditLog, getCurrentUser, getUsers, login, revokeUserSessions,
  updateManagedUser, updateProfile, updateUserAccess
} from '../controllers/auth.controller';

// 👇 AQUÍ IMPORTAMOS AL GUARDIA QUE ACABAS DE CREAR
import { requirePermission, requireStaff, verifyToken } from '../middlewares/auth.middleware';
import { PERMISSIONS } from '../security/rbac';

import { getCalendars, addCalendar, deleteCalendar, syncAllAppointments } from '../controllers/googleAuth.controller';
import { authRateLimiter, authIpRateLimiter, passwordResetAccountRateLimiter, passwordResetIpRateLimiter } from '../middlewares/rate-limiters';

const router = Router();

router.post('/login', authIpRateLimiter, authRateLimiter, login);
router.post('/password-reset/complete', passwordResetIpRateLimiter, passwordResetAccountRateLimiter, completePosPasswordReset);
router.get('/me', verifyToken, requireStaff, getCurrentUser);
router.post('/change-password', verifyToken, requireStaff, requirePermission(PERMISSIONS.profilePasswordChange), changeOwnPassword);
router.put('/profile', verifyToken, requireStaff, requirePermission(PERMISSIONS.businessSettingsManage), updateProfile);
router.get('/users', verifyToken, requireStaff, requirePermission(PERMISSIONS.usersRead), getUsers);
router.post('/users', verifyToken, requireStaff, requirePermission(PERMISSIONS.usersCreate), createUser);
router.patch('/users/:id', verifyToken, requireStaff, requirePermission(PERMISSIONS.usersUpdate), updateManagedUser);
router.patch('/users/:id/access', verifyToken, requireStaff, requirePermission(PERMISSIONS.usersUpdate), updateUserAccess);
router.post('/users/:id/password-reset', verifyToken, requireStaff, requirePermission(PERMISSIONS.usersResetPassword), adminResetPassword);
router.post('/users/:id/revoke-sessions', verifyToken, requireStaff, requirePermission(PERMISSIONS.usersRevokeSessions), revokeUserSessions);
router.get('/audit', verifyToken, requireStaff, requirePermission(PERMISSIONS.auditRead), getAdminAuditLog);

// Rutas de Google Service Account
router.get('/google/calendars', verifyToken, requireStaff, requirePermission(PERMISSIONS.integrationsManage), getCalendars);
router.post('/google/calendar', verifyToken, requireStaff, requirePermission(PERMISSIONS.integrationsManage), addCalendar);
router.delete('/google/calendar/:id', verifyToken, requireStaff, requirePermission(PERMISSIONS.integrationsManage), deleteCalendar);
router.post('/google/calendar/:id/sync', verifyToken, requireStaff, requirePermission(PERMISSIONS.integrationsManage), syncAllAppointments);

export default router;
