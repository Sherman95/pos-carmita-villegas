import { Router } from 'express';
import { login, updateProfile } from '../controllers/auth.controller';

// 👇 AQUÍ IMPORTAMOS AL GUARDIA QUE ACABAS DE CREAR
import { verifyToken } from '../middlewares/auth.middleware';

import { getCalendars, addCalendar, deleteCalendar, syncAllAppointments } from '../controllers/googleAuth.controller';

const router = Router();

router.post('/login', login);
router.put('/profile', verifyToken, updateProfile);

// Rutas de Google Service Account
router.get('/google/calendars', verifyToken, getCalendars);
router.post('/google/calendar', verifyToken, addCalendar);
router.delete('/google/calendar/:id', verifyToken, deleteCalendar);
router.post('/google/calendar/:id/sync', verifyToken, syncAllAppointments);

export default router;