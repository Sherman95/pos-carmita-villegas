import { Router } from 'express';
import { login, updateProfile } from '../controllers/auth.controller';

// 👇 AQUÍ IMPORTAMOS AL GUARDIA QUE ACABAS DE CREAR
import { verifyToken } from '../middlewares/auth.middleware';

import { getGoogleSyncStatus, updateCalendarId } from '../controllers/googleAuth.controller';

const router = Router();

router.post('/login', login);
router.put('/profile', verifyToken, updateProfile);

// Rutas de Google Service Account
router.get('/google/status', verifyToken, getGoogleSyncStatus);
router.post('/google/calendar', verifyToken, updateCalendarId);

export default router;