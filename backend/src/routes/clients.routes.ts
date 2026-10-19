import { Router } from 'express';
import { requirePermission, requireStaff, verifyToken } from '../middlewares/auth.middleware';
import { PERMISSIONS } from '../security/rbac';
import {
    getClients,
    createClient,
    updateClient,
    getClientDeletionImpact,
    deleteClient
} from '../controllers/clients.controller';

const router = Router();
router.use(verifyToken, requireStaff);

router.get('/', requirePermission(PERMISSIONS.clientsRead), getClients);
router.get('/:id/deletion-impact', requirePermission(PERMISSIONS.clientsDelete), getClientDeletionImpact);
router.post('/', requirePermission(PERMISSIONS.clientsCreate), createClient);
router.put('/:id', requirePermission(PERMISSIONS.clientsUpdate), updateClient);
router.delete('/:id', requirePermission(PERMISSIONS.clientsDelete), deleteClient);

export default router;
