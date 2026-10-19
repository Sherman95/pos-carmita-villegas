import { Router } from 'express';
import { verifyToken, requirePermission, requireStaff } from '../middlewares/auth.middleware';
import { PERMISSIONS } from '../security/rbac';
import { getExpensesReport } from '../controllers/reports.controller';

const router = Router();
router.use(verifyToken, requireStaff, requirePermission(PERMISSIONS.reportsRead));

// Definimos la ruta: /api/reports/expenses
router.get('/expenses', getExpensesReport);

export default router;
