import { Router } from 'express';
import { requirePermission, requireStaff, verifyToken } from '../middlewares/auth.middleware';
import { PERMISSIONS } from '../security/rbac';

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
router.get('/status', requirePermission(PERMISSIONS.cashOperate), getStatus);
router.post('/open', requirePermission(PERMISSIONS.cashOperate), openRegister);
router.get('/details', requirePermission(PERMISSIONS.cashOperate), getClosingDetails);
router.post('/close/:id', requirePermission(PERMISSIONS.cashOperate), closeRegister);
router.get('/history', requirePermission(PERMISSIONS.cashHistory), getCashHistory);


// 👇 ESTA ES LA LÍNEA QUE SUELE FALTAR. ¿LA TIENES?
router.get('/report/:id', requirePermission(PERMISSIONS.cashHistory), getClosingReport);

export default router;
