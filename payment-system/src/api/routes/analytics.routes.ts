// src/api/routes/analytics.routes.ts
import { Router } from 'express';
import { AnalyticsController } from '../controllers/analytics.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { 
  metricsQuerySchema, 
  reportQuerySchema 
} from '../validators/schemas';

const router = Router();
const controller = new AnalyticsController();

router.get(
  '/metrics',
  authMiddleware,
  validateRequest({ query: metricsQuerySchema }),
  controller.getMetrics
);

router.get(
  '/reports',
  authMiddleware,
  validateRequest({ query: reportQuerySchema }),
  controller.generateReport
);

router.get(
  '/dashboard',
  authMiddleware,
  controller.getDashboardData
);

export { router as analyticsRouter };