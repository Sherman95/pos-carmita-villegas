import { Router } from 'express';
// 👇 IMPORTA LAS NUEVAS FUNCIONES AQUÍ
import { 
    createSale, 
    getSales, 
    getSalesByRange, 
    getSalesSummary, 
    getSalesByClient, 
    getSaleWithDetails, 
    getSaleDetailsBatch,
    getSalesByItem, 
    getReceiptsByClient,
    getDebtors,      // <--- NUEVO
    registerPayment  // <--- NUEVO
} from '../controllers/sales.controller';

const router = Router();

// ... tus rutas existentes ...
router.get('/', getSales);
router.get('/range', getSalesByRange);
router.get('/summary', getSalesSummary);

// 👇 RUTAS DE COBRANZA (AGREGAR ESTAS)
router.get('/debtors', getDebtors);      // Para ver la lista de morosos
router.post('/payment', registerPayment); // Para abonar

// ... resto de rutas ...
router.get('/by-client/:clientId', getSalesByClient);
router.get('/by-item/:itemId', getSalesByItem);
router.get('/receipt-by-client/:clientId', getReceiptsByClient);
router.post('/details/batch', getSaleDetailsBatch);
router.get('/:id', getSaleWithDetails);
router.post('/', createSale); 

export default router;
