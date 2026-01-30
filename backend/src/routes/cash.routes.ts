import { Router } from 'express';

// 👇 ASEGÚRATE DE IMPORTAR 'getClosingReport' AQUÍ
import { 
    getStatus, 
    openRegister, 
    getClosingDetails, 
    closeRegister, 
    getCashHistory, 
    getClosingReport // <--- ¡IMPORTANTE!
} from '../controllers/cash.controller';

const router = Router();

// Rutas
router.get('/status', getStatus);
router.post('/open', openRegister);
router.get('/details', getClosingDetails);
router.post('/close/:id', closeRegister);
router.get('/history', getCashHistory);

// 👇 ESTA ES LA LÍNEA QUE SUELE FALTAR. ¿LA TIENES?
router.get('/report/:id', getClosingReport);

export default router;