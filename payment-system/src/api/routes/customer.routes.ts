// src/api/routes/customer.routes.ts
const customerRouter = Router();
const customerController = new CustomerController();

customerRouter.post(
  '/profiles',
  authMiddleware,
  validateRequest('createProfile'),
  customerController.createProfile
);

customerRouter.get(
  '/profiles/me',
  authMiddleware,
  customerController.getCurrentProfile
);

customerRouter.patch(
  '/profiles/me',
  authMiddleware,
  validateRequest('updateProfile'),
  customerController.updateProfile
);

customerRouter.patch(
  '/profiles/me/limits',
  authMiddleware,
  validateRequest('updateLimits'),
  customerController.updateSpendingLimits
);

customerRouter.get(
  '/profiles/me/risk-assessment',
  authMiddleware,
  customerController.getRiskAssessment
);

export { router as paymentMethodsRouter, currencyRouter, customerRouter };