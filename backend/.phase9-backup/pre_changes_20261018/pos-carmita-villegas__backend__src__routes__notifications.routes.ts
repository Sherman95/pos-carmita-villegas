import { Router } from 'express';
import { listNotifications, markNotificationRead } from '../controllers/notifications.controller';
import { requireStaff, verifyToken } from '../middlewares/auth.middleware';

const router = Router();

router.use(verifyToken, requireStaff);
router.get('/', listNotifications);
router.post('/:id/read', markNotificationRead);

export default router;
