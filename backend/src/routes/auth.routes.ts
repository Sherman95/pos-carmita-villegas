import { Router } from 'express';
import { getCurrentUser, getUsers, login, updateProfile, updateUserAccess } from '../controllers/auth.controller';

// 👇 AQUÍ IMPORTAMOS AL GUARDIA QUE ACABAS DE CREAR
import { requireAdmin, verifyToken } from '../middlewares/auth.middleware';

import { getCalendars, addCalendar, deleteCalendar, syncAllAppointments } from '../controllers/googleAuth.controller';
import { authRateLimiter, authIpRateLimiter } from '../middlewares/rate-limiters';

const router = Router();

router.post('/login', authIpRateLimiter, authRateLimiter, login);
router.get('/me', verifyToken, getCurrentUser);
router.put('/profile', verifyToken, updateProfile);
router.get('/users', verifyToken, requireAdmin, getUsers);
router.patch('/users/:id/access', verifyToken, requireAdmin, updateUserAccess);

// Rutas de Google Service Account
router.get('/google/calendars', verifyToken, requireAdmin, getCalendars);
router.post('/google/calendar', verifyToken, requireAdmin, addCalendar);
router.delete('/google/calendar/:id', verifyToken, requireAdmin, deleteCalendar);
router.post('/google/calendar/:id/sync', verifyToken, requireAdmin, syncAllAppointments);

export default router;
