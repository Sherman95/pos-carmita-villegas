import { Router } from 'express';
import { createExpense, getExpenses, deleteExpense } from '../controllers/expenses.controller';

const router = Router();

// Definimos las URLs
router.post('/', createExpense);      // Guardar
router.get('/', getExpenses);         // Ver lista
router.delete('/:id', deleteExpense); // Borrar

export default router;