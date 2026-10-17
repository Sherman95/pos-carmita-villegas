import { Router } from 'express';
import {
    listAccounts, linkAccount,
    updateServiceConfig, getServiceConfig,
    setEmployeeSchedule, getEmployeeSchedule,
    listRequests, acceptRequest, rejectRequest, proposeAlternativeRequest,
    linkUserToEmployee,
    getServiceImageUploadSignature, saveServiceImageReference, removeServiceImage
} from '../controllers/adminSidro.controller';
import { requireAdmin, requireStaff, verifyToken } from '../middlewares/auth.middleware';

const router = Router();

// Rutas protegidas para el administrador del POS
router.use(verifyToken, requireStaff);

router.get('/accounts', requireAdmin, listAccounts);
router.post('/link', requireAdmin, linkAccount);
router.post('/users/:id/link-employee', requireAdmin, linkUserToEmployee);

// Rutas de Configuración de Servicios
router.get('/services/:id', requireAdmin, getServiceConfig);
router.put('/services/:id', requireAdmin, updateServiceConfig);
router.post('/services/:id/image/signature', requireAdmin, getServiceImageUploadSignature);
router.put('/services/:id/image', requireAdmin, saveServiceImageReference);
router.delete('/services/:id/image', requireAdmin, removeServiceImage);

// Rutas de Configuración de Horarios de Empleados
// Estas rutas validarán internamente en el controlador si es admin o el propio profesional
router.get('/employees/:employee_id/schedule', getEmployeeSchedule);
router.put('/employees/:employee_id/schedule', setEmployeeSchedule);

// Gestión de Solicitudes
router.get('/requests', listRequests);
router.post('/requests/:id/accept', acceptRequest);
router.post('/requests/:id/reject', rejectRequest);
router.post('/requests/:id/propose', proposeAlternativeRequest);

export default router;
