// backend/src/routes/auth.routes.ts
import { Router } from 'express';
import { login, updateProfile } from '../controllers/auth.controller';

// 👇 AQUÍ IMPORTAMOS AL GUARDIA QUE ACABAS DE CREAR
import { verifyToken } from '../middlewares/auth.middleware';

const router = Router();

router.post('/login', login);
router.put('/profile', verifyToken, updateProfile); // 🔒 Ruta protegida

export default router;