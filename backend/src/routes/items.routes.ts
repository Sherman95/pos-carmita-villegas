import { Router } from 'express';
import { requirePermission, requireStaff, verifyToken } from '../middlewares/auth.middleware';
import { PERMISSIONS } from '../security/rbac';
import { getItems, createItem, deleteItem, updateItem } from '../controllers/items.controller';

const router = Router();
router.use(verifyToken, requireStaff);

router.get('/', requirePermission(PERMISSIONS.catalogRead), getItems);
router.post('/', requirePermission(PERMISSIONS.catalogManage), createItem);
router.put('/:id', requirePermission(PERMISSIONS.catalogManage), updateItem);
router.delete('/:id', requirePermission(PERMISSIONS.catalogManage), deleteItem);

export default router;
