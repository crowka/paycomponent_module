// src/api/routes/currency.routes.ts
const currencyRouter = Router();
const currencyController = new CurrencyController();

currencyRouter.get(
  '/rates',
  authMiddleware,
  currencyController.getExchangeRates
);

currencyRouter.get(
  '/convert',
  authMiddleware,
  validateRequest('currencyConversion'),
  currencyController.convertAmount
);

currencyRouter.get(
  '/supported',
  currencyController.getSupportedCurrencies
);