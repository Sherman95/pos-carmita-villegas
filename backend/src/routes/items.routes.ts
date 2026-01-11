import { Router } from 'express';
import { getItems, createItem, deleteItem, updateItem } from '../controllers/items.controller';

const router = Router();

router.get('/', getItems);
router.post('/', createItem);
router.put('/:id', updateItem);
router.delete('/:id', deleteItem);

export default router;