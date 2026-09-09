import { Router } from 'express';
import { getEmployees, createEmployee, updateEmployee, deleteEmployee } from '../controllers/employees.controller';
import { verifyToken } from '../middlewares/auth.middleware';

const router = Router();

// Todas las rutas de empleados protegidas por token
router.use(verifyToken);

router.get('/', getEmployees);
router.post('/', createEmployee);
router.put('/:id', updateEmployee);
router.delete('/:id', deleteEmployee);

export default router;
