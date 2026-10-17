import { Router } from 'express';
import { verifyToken, requireAdmin, requireStaff } from '../middlewares/auth.middleware';
import { getExpensesReport } from '../controllers/reports.controller';

const router = Router();
router.use(verifyToken, requireStaff, requireAdmin);

// Definimos la ruta: /api/reports/expenses
router.get('/expenses', getExpensesReport);

export default router;
