import { Router } from 'express';
import { verifyToken } from '../middlewares/auth.middleware';
import {
    getClients,
    createClient,
    updateClient,
    getClientDeletionImpact,
    deleteClient
} from '../controllers/clients.controller';

const router = Router();
router.use(verifyToken);

router.get('/', getClients);
router.get('/:id/deletion-impact', getClientDeletionImpact);
router.post('/', createClient);
router.put('/:id', updateClient);
router.delete('/:id', deleteClient);

export default router;
