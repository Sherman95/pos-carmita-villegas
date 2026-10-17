import { Router } from 'express';
import { requireStaff, verifyToken } from '../middlewares/auth.middleware';

// 👇 ASEGÚRATE DE IMPORTAR 'getClosingReport' AQUÍ
import {
    getStatus,
    openRegister,
    getClosingDetails,
    closeRegister,
    getCashHistory,
    getClosingReport // <--- ¡IMPORTANTE!
} from '../controllers/cashIntegrity.controller';

const router = Router();
router.use(verifyToken, requireStaff);

// Rutas
router.get('/status', getStatus);
router.post('/open', openRegister);
router.get('/details', getClosingDetails);
router.post('/close/:id', closeRegister);
router.get('/history', getCashHistory);


// 👇 ESTA ES LA LÍNEA QUE SUELE FALTAR. ¿LA TIENES?
router.get('/report/:id', getClosingReport);

export default router;
