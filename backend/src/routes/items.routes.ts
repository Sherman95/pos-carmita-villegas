import { Router } from 'express';
import { requireStaff, verifyToken } from '../middlewares/auth.middleware';
import { getItems, createItem, deleteItem, updateItem } from '../controllers/items.controller';

const router = Router();
router.use(verifyToken, requireStaff);

router.get('/', getItems);
router.post('/', createItem);
router.put('/:id', updateItem);
router.delete('/:id', deleteItem);

export default router;
