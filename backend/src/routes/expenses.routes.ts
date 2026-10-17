import { Router } from 'express';
import { verifyToken, requireAdmin, requireStaff } from '../middlewares/auth.middleware';
import {
    createExpense,
    getExpenses,
    deleteExpense,
    getCategories,
    createCategory,
    updateCategory,
    deleteCategory
} from '../controllers/expenses.controller';

const router = Router();
router.use(verifyToken, requireStaff, requireAdmin);

// ==========================================
// RUTAS DE CATEGORÍAS (CRUD)
// ==========================================
router.get('/categories', getCategories);
router.post('/categories', createCategory);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

// ==========================================
// RUTAS DE GASTOS
// ==========================================
router.post('/', createExpense);      // Guardar
router.get('/', getExpenses);         // Ver lista
router.delete('/:id', deleteExpense); // Borrar

export default router;
