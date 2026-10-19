import { Router } from 'express';
import {
    getAppointments,
    getAppointmentById,
    createAppointment,
    updateAppointment,
    deleteAppointment
} from '../controllers/appointments.controller';
import { requireAnyPermission, requirePermission, requireStaff, verifyToken } from '../middlewares/auth.middleware';
import { PERMISSIONS } from '../security/rbac';

const router = Router();

// Aplicar middleware de autenticación a todas las rutas de citas
router.use(verifyToken, requireStaff);

router.get('/', requireAnyPermission(PERMISSIONS.appointmentsRead, PERMISSIONS.appointmentsReadOwn), getAppointments);
router.get('/:id', requireAnyPermission(PERMISSIONS.appointmentsRead, PERMISSIONS.appointmentsReadOwn), getAppointmentById);
router.post('/', requirePermission(PERMISSIONS.appointmentsCreate), createAppointment);
router.put('/:id', requireAnyPermission(PERMISSIONS.appointmentsUpdate, PERMISSIONS.appointmentsUpdateOwn), updateAppointment);
router.delete('/:id', requirePermission(PERMISSIONS.appointmentsCancel), deleteAppointment);

export default router;
