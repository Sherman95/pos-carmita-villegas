import { Router } from 'express';
import { verifyToken } from '../middlewares/auth.middleware';
import { getItems, createItem, deleteItem, updateItem } from '../controllers/items.controller';

const router = Router();
router.use(verifyToken);

router.get('/', getItems);
router.post('/', createItem);
router.put('/:id', updateItem);
router.delete('/:id', deleteItem);

export default router;
