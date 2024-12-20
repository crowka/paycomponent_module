// src/api/controllers/customer.controller.ts
import { Request, Response } from 'express';
import { CustomerManager } from '../../lib/payment/customer/customer.manager';

export class CustomerController {
  constructor(private customerManager: CustomerManager) {}

  createProfile = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, name, defaultCurrency, preferences, limits } = req.body;
      
      const profile = await this.customerManager.createProfile(email, {
        name,
        defaultCurrency,
        preferences,
        limits
      });

      res.status(201).json(profile);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  getCurrentProfile = async (req: Request, res: Response): Promise<void> => {
    try {
      const profile = await this.customerManager.getProfile(req.user.id);
      if (!profile) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }
      res.json(profile);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  updateProfile = async (req: Request, res: Response): Promise<void> => {
    try {
      const updates = req.body;
      const profile = await this.customerManager.updateProfile(
        req.user.id,
        updates
      );
      res.json(profile);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  updateSpendingLimits = async (req: Request, res: Response): Promise<void> => {
    try {
      const limits = req.body;
      const profile = await this.customerManager.updateSpendingLimits(
        req.user.id,
        limits
      );
      res.json(profile);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  getRiskAssessment = async (req: Request, res: Response): Promise<void> => {
    try {
      const riskLevel = await this.customerManager.assessRisk(req.user.id);
      res.json({ riskLevel });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };
}