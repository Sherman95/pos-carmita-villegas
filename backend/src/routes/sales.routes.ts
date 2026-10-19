import { Router } from 'express';
import { requirePermission, requireStaff, verifyToken } from '../middlewares/auth.middleware';
import { PERMISSIONS } from '../security/rbac';
// 👇 IMPORTA LAS NUEVAS FUNCIONES AQUÍ
import {
    createSale,
    getSales,
    getSalesByRange,
    getSalesSummary,
    getSalesByClient,
    getSaleWithDetails,
    getSaleDetailsBatch,
    getSalesByItem,
    getReceiptsByClient,
    getDebtors,      // <--- NUEVO
    registerPayment  // <--- NUEVO
} from '../controllers/sales.controller';

const router = Router();
router.use(verifyToken, requireStaff);

// ... tus rutas existentes ...
router.get('/', requirePermission(PERMISSIONS.salesRead), getSales);
router.get('/range', requirePermission(PERMISSIONS.salesRead), getSalesByRange);
router.get('/summary', requirePermission(PERMISSIONS.salesRead), getSalesSummary);

// 👇 RUTAS DE COBRANZA (AGREGAR ESTAS)
router.get('/debtors', requirePermission(PERMISSIONS.salesRead), getDebtors);
router.post('/payment', requirePermission(PERMISSIONS.paymentsCreate), registerPayment);

// ... resto de rutas ...
router.get('/by-client/:clientId', requirePermission(PERMISSIONS.salesRead), getSalesByClient);
router.get('/by-item/:itemId', requirePermission(PERMISSIONS.salesRead), getSalesByItem);
router.get('/receipt-by-client/:clientId', requirePermission(PERMISSIONS.salesRead), getReceiptsByClient);
router.post('/details/batch', requirePermission(PERMISSIONS.salesRead), getSaleDetailsBatch);
router.get('/:id', requirePermission(PERMISSIONS.salesRead), getSaleWithDetails);
router.post('/', requirePermission(PERMISSIONS.salesCreate), createSale);

export default router;
