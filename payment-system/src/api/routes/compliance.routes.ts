// src/api/routes/compliance.routes.ts
import { ComplianceController } from '../controllers/compliance.controller';

const complianceRouter = Router();
const complianceController = new ComplianceController();

complianceRouter.get(
  '/rules',
  authMiddleware,
  complianceController.getRules
);

complianceRouter.post(
  '/validate',
  authMiddleware,
  validateRequest('complianceValidation'),
  complianceController.validateCompliance
);

complianceRouter.get(
  '/audit-logs',
  authMiddleware,
  complianceController.getAuditLogs
);

export { complianceRouter };
