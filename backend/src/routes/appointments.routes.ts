import { Router } from 'express';
import {
    getAppointments,
    getAppointmentById,
    createAppointment,
    updateAppointment,
    deleteAppointment
} from '../controllers/appointments.controller';
import { verifyToken } from '../middlewares/auth.middleware';

const router = Router();

// Aplicar middleware de autenticación a todas las rutas de citas
router.use(verifyToken);

router.get('/', getAppointments);
router.get('/:id', getAppointmentById);
router.post('/', createAppointment);
router.put('/:id', updateAppointment);
router.delete('/:id', deleteAppointment);

export default router;
