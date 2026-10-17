import { Router } from 'express';
import { getCurrentUser, getUsers, login, updateProfile, updateUserAccess } from '../controllers/auth.controller';

// 👇 AQUÍ IMPORTAMOS AL GUARDIA QUE ACABAS DE CREAR
import { requireAdmin, requireStaff, verifyToken } from '../middlewares/auth.middleware';

import { getCalendars, addCalendar, deleteCalendar, syncAllAppointments } from '../controllers/googleAuth.controller';
import { authRateLimiter, authIpRateLimiter } from '../middlewares/rate-limiters';

const router = Router();

router.post('/login', authIpRateLimiter, authRateLimiter, login);
router.get('/me', verifyToken, requireStaff, getCurrentUser);
router.put('/profile', verifyToken, requireStaff, updateProfile);
router.get('/users', verifyToken, requireStaff, requireAdmin, getUsers);
router.patch('/users/:id/access', verifyToken, requireStaff, requireAdmin, updateUserAccess);

// Rutas de Google Service Account
router.get('/google/calendars', verifyToken, requireStaff, requireAdmin, getCalendars);
router.post('/google/calendar', verifyToken, requireStaff, requireAdmin, addCalendar);
router.delete('/google/calendar/:id', verifyToken, requireStaff, requireAdmin, deleteCalendar);
router.post('/google/calendar/:id/sync', verifyToken, requireStaff, requireAdmin, syncAllAppointments);

export default router;
