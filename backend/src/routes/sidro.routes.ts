import { Router } from 'express';
import {
  register,
  login,
  getProfile,
  requestPasswordReset,
  resetPassword,
  updateRecoveryEmail
} from '../controllers/sidroAuth.controller';
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
import { verifyToken } from '../middlewares/auth.middleware';
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
router.post('/password/forgot', passwordResetIpRateLimiter, passwordResetAccountRateLimiter, requestPasswordReset);
router.post('/password/reset', passwordResetIpRateLimiter, resetPassword);
router.get('/public/services', getPublicServices);
router.get('/public/professionals', getServicesProfessionals);
router.get('/public/services/:id/professionals', getServiceProfessionals);

// Protegidas
router.get('/profile', verifyToken, getProfile);
router.put('/profile/recovery-email', verifyToken, authRateLimiter, updateRecoveryEmail);
router.post('/requests', verifyToken, createRequest);
router.get('/requests', verifyToken, getMyRequests);
router.post('/requests/:id/accept-proposal', verifyToken, acceptProposal);
router.post('/requests/:id/reject-proposal', verifyToken, rejectProposal);
router.get('/availability', verifyToken, getAvailability);

export default router;
