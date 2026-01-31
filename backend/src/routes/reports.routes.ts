import { Router } from 'express';
import { getExpensesReport } from '../controllers/reports.controller';

const router = Router();

// Definimos la ruta: /api/reports/expenses
router.get('/expenses', getExpensesReport);

export default router;