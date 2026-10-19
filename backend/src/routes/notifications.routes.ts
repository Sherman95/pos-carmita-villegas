import { Router } from 'express';
import { listNotifications, markNotificationRead } from '../controllers/notifications.controller';
import { getPushConfiguration, registerPushSubscription, revokePushSubscription } from '../controllers/pushSubscriptions.controller';
import { requireStaff, verifyToken } from '../middlewares/auth.middleware';

const router = Router();

router.use(verifyToken, requireStaff);
router.get('/push/config', getPushConfiguration);
router.post('/subscriptions', registerPushSubscription);
router.delete('/subscriptions', revokePushSubscription);
router.get('/', listNotifications);
router.post('/:id/read', markNotificationRead);

export default router;
