import { Router } from 'express';
import {
  register,
  login,
  getProfile,
  completeProfileData,
  requestPasswordReset,
  resetPassword,
  updateRecoveryEmail,
  legacyLogin,
  verifyEmailChange,
  updateWhatsapp,
  changePassword
} from '../controllers/sidroAuthPhase4.controller';
import {
  acceptProposal,
  createRequest,
  getAvailability,
  getMyRequests,
  getPublicServices,
  getServiceProfessionals,
  getServicesProfessionals,
  rejectProposal
} from '../controllers/sidroAppointments.controller';
import { getPublicWhatsappContact } from '../controllers/businessSettings.controller';
import { listNotifications, markNotificationRead } from '../controllers/notifications.controller';
import { requireSidroClient, verifyToken } from '../middlewares/auth.middleware';
import {
  authRateLimiter,
  authIpRateLimiter,
  registrationRateLimiter,
  passwordResetIpRateLimiter,
  passwordResetAccountRateLimiter
} from '../middlewares/rate-limiters';

const router = Router();

// Publicas para las clientas (PWA SIDRO)
router.post('/register', registrationRateLimiter, register);
router.post('/login', authIpRateLimiter, authRateLimiter, login);
router.post('/login/legacy', authIpRateLimiter, authRateLimiter, legacyLogin);
router.post('/password/forgot', passwordResetIpRateLimiter, passwordResetAccountRateLimiter, requestPasswordReset);
router.post('/password/reset', passwordResetIpRateLimiter, resetPassword);
router.post('/email/verify', passwordResetIpRateLimiter, verifyEmailChange);
router.get('/public/whatsapp', getPublicWhatsappContact);
router.get('/public/services', getPublicServices);
router.get('/public/professionals', getServicesProfessionals);
router.get('/public/services/:id/professionals', getServiceProfessionals);

// Protegidas
router.use(verifyToken, requireSidroClient);
router.get('/profile', getProfile);
router.put('/profile/complete-data', authRateLimiter, completeProfileData);
router.put('/profile/recovery-email', authRateLimiter, updateRecoveryEmail);
router.put('/profile/whatsapp', authRateLimiter, updateWhatsapp);
router.post('/profile/change-password', authRateLimiter, changePassword);
router.post('/requests', createRequest);
router.get('/requests', getMyRequests);
router.post('/requests/:id/accept-proposal', acceptProposal);
router.post('/requests/:id/reject-proposal', rejectProposal);
router.get('/availability', getAvailability);
router.get('/notifications', listNotifications);
router.post('/notifications/:id/read', markNotificationRead);

export default router;
