import { Router } from 'express';
import { createSale, getSales, getSalesByRange, getSalesSummary, getSalesByClient, getSaleWithDetails, getSalesByItem, saveSaleReceipt, getSaleReceipt, getReceiptsByClient } from '../controllers/sales.controller';

const router = Router();

router.get('/', getSales);
router.get('/range', getSalesByRange);
router.get('/summary', getSalesSummary);
router.get('/by-client/:clientId', getSalesByClient);
router.get('/by-item/:itemId', getSalesByItem);
router.get('/receipt-by-client/:clientId', getReceiptsByClient);
router.get('/:id/receipt', getSaleReceipt);
router.get('/:id', getSaleWithDetails);
router.post('/', createSale); 
router.post('/:id/receipt', saveSaleReceipt);

export default router;