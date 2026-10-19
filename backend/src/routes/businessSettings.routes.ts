import { Router } from 'express';
import {
  getCashControlSetting,
  updateCashControlSetting,
  getWhatsappContactSetting,
  updateWhatsappContactSetting
} from '../controllers/businessSettings.controller';
import { requirePermission, requireStaff, verifyToken } from '../middlewares/auth.middleware';
import { PERMISSIONS } from '../security/rbac';

const router = Router();

router.use(verifyToken, requireStaff);
router.get('/cash-control', getCashControlSetting);
router.put('/cash-control', requirePermission(PERMISSIONS.cashSettingsManage), updateCashControlSetting);
router.get('/whatsapp-contact', requirePermission(PERMISSIONS.businessSettingsManage), getWhatsappContactSetting);
router.put('/whatsapp-contact', requirePermission(PERMISSIONS.businessSettingsManage), updateWhatsappContactSetting);

export default router;
