import { Router } from 'express';
import {
    listAccounts, linkAccount,
    getAccountDetail, getAccountMatches, createClientAndLink,
    updateServiceConfig, getServiceConfig,
    setEmployeeSchedule, getEmployeeSchedule,
    listRequests, acceptRequest, rejectRequest, proposeAlternativeRequest,
    linkUserToEmployee,
    getServiceImageUploadSignature, saveServiceImageReference, removeServiceImage
} from '../controllers/adminSidro.controller';
import { requireAnyPermission, requirePermission, requireStaff, verifyToken } from '../middlewares/auth.middleware';
import { PERMISSIONS } from '../security/rbac';

const router = Router();

// Rutas protegidas para el administrador del POS
router.use(verifyToken, requireStaff);

router.get('/accounts', requirePermission(PERMISSIONS.sidroAccountsLink), listAccounts);
router.get('/accounts/:id/detail', requirePermission(PERMISSIONS.sidroAccountsLink), getAccountDetail);
router.get('/accounts/:id/matches', requirePermission(PERMISSIONS.sidroAccountsLink), getAccountMatches);
router.post('/link', requirePermission(PERMISSIONS.sidroAccountsLink), linkAccount);
router.post('/link/create-client', requirePermission(PERMISSIONS.sidroAccountsLink), createClientAndLink);
router.post('/users/:id/link-employee', requirePermission(PERMISSIONS.usersUpdate), linkUserToEmployee);

// Rutas de Configuración de Servicios
router.get('/services/:id', requirePermission(PERMISSIONS.sidroServicesConfigure), getServiceConfig);
router.put('/services/:id', requirePermission(PERMISSIONS.sidroServicesConfigure), updateServiceConfig);
router.post('/services/:id/image/signature', requirePermission(PERMISSIONS.sidroServicesConfigure), getServiceImageUploadSignature);
router.put('/services/:id/image', requirePermission(PERMISSIONS.sidroServicesConfigure), saveServiceImageReference);
router.delete('/services/:id/image', requirePermission(PERMISSIONS.sidroServicesConfigure), removeServiceImage);

// Rutas de Configuración de Horarios de Empleados
// Estas rutas validarán internamente en el controlador si es admin o el propio profesional
router.get('/employees/:employee_id/schedule', requireAnyPermission(PERMISSIONS.schedulesManage, PERMISSIONS.schedulesManageOwn), getEmployeeSchedule);
router.put('/employees/:employee_id/schedule', requireAnyPermission(PERMISSIONS.schedulesManage, PERMISSIONS.schedulesManageOwn), setEmployeeSchedule);

// Gestión de Solicitudes
router.get('/requests', requireAnyPermission(PERMISSIONS.sidroManage, PERMISSIONS.sidroManageOwn), listRequests);
router.post('/requests/:id/accept', requireAnyPermission(PERMISSIONS.sidroManage, PERMISSIONS.sidroManageOwn), acceptRequest);
router.post('/requests/:id/reject', requireAnyPermission(PERMISSIONS.sidroManage, PERMISSIONS.sidroManageOwn), rejectRequest);
router.post('/requests/:id/propose', requireAnyPermission(PERMISSIONS.sidroManage, PERMISSIONS.sidroManageOwn), proposeAlternativeRequest);

export default router;
