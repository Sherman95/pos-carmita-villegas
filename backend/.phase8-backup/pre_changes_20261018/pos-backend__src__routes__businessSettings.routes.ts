import { Router } from 'express';
import { getCashControlSetting, updateCashControlSetting } from '../controllers/businessSettings.controller';
import { requirePermission, requireStaff, verifyToken } from '../middlewares/auth.middleware';
import { PERMISSIONS } from '../security/rbac';

const router = Router();

router.use(verifyToken, requireStaff);
router.get('/cash-control', getCashControlSetting);
router.put('/cash-control', requirePermission(PERMISSIONS.cashSettingsManage), updateCashControlSetting);

export default router;
