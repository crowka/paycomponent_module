// src/api/controllers/currency.controller.ts
import { Request, Response } from 'express';
import { CurrencyManager } from '../../lib/payment/currency/currency.manager';

export class CurrencyController {
  constructor(private currencyManager: CurrencyManager) {}

  getExchangeRates = async (req: Request, res: Response): Promise<void> => {
    try {
      const { base, target } = req.query;
      const rate = await this.currencyManager.getExchangeRate(
        base as string,
        target as string
      );
      res.json({ rate });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  convertAmount = async (req: Request, res: Response): Promise<void> => {
    try {
      const { amount, from, to } = req.query;
      const converted = await this.currencyManager.convertAmount(
        Number(amount),
        from as string,
        to as string
      );
      res.json({ 
        amount: converted,
        formatted: this.currencyManager.formatAmount(converted, to as string)
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  getSupportedCurrencies = async (req: Request, res: Response): Promise<void> => {
    try {
      const currencies = await this.currencyManager.getSupportedCurrencies();
      res.json(currencies);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };
}