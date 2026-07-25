import { Router } from 'express';
import {
    getClients,
    createClient,
    updateClient,
    getClientDeletionImpact,
    deleteClient
} from '../controllers/clients.controller';

const router = Router();

router.get('/', getClients);
router.get('/:id/deletion-impact', getClientDeletionImpact);
router.post('/', createClient);
router.put('/:id', updateClient);
router.delete('/:id', deleteClient);

export default router;
