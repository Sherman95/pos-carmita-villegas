import { Router } from 'express';
import { getEmployees, createEmployee, updateEmployee, deleteEmployee } from '../controllers/employees.controller';
import { requirePermission, requireStaff, verifyToken } from '../middlewares/auth.middleware';
import { PERMISSIONS } from '../security/rbac';

const router = Router();

// Todas las rutas de empleados protegidas por token
router.use(verifyToken, requireStaff);

router.get('/', requirePermission(PERMISSIONS.employeesRead), getEmployees);
router.post('/', requirePermission(PERMISSIONS.employeesManage), createEmployee);
router.put('/:id', requirePermission(PERMISSIONS.employeesManage), updateEmployee);
router.delete('/:id', requirePermission(PERMISSIONS.employeesManage), deleteEmployee);

export default router;
