import { Router } from 'express';
import { createSale, getSales, getSalesByRange, getSalesSummary, getSalesByClient, getSaleWithDetails, getSalesByItem } from '../controllers/sales.controller';

const router = Router();

router.get('/', getSales);
router.get('/range', getSalesByRange);
router.get('/summary', getSalesSummary);
router.get('/by-client/:clientId', getSalesByClient);
router.get('/by-item/:itemId', getSalesByItem);
router.get('/:id', getSaleWithDetails);
router.post('/', createSale); 

export default router;