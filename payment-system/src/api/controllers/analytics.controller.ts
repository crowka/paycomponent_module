// src/api/controllers/analytics.controller.ts
import { Request, Response } from 'express';
import { AnalyticsManager } from '../../lib/payment/analytics/analytics.manager';
import { ReportType } from '../../lib/payment/analytics/types';

export class AnalyticsController {
  constructor(private analyticsManager: AnalyticsManager) {}

  getMetrics = async (req: Request, res: Response): Promise<void> => {
    try {
      const { dimension, startDate, endDate } = req.query;
      const metrics = await this.analyticsManager.getMetrics({
        dimension: dimension as string,
        dateRange: {
          startDate: startDate ? new Date(startDate as string) : undefined,
          endDate: endDate ? new Date(endDate as string) : undefined
        }
      });
      res.json(metrics);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  generateReport = async (req: Request, res: Response): Promise<void> => {
    try {
      const { type, startDate, endDate } = req.query;
      const report = await this.analyticsManager.generateReport(
        type as ReportType,
        {
          startDate: new Date(startDate as string),
          endDate: new Date(endDate as string)
        }
      );
      res.json(report);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  getDashboardData = async (req: Request, res: Response): Promise<void> => {
    try {
      const dashboard = await this.analyticsManager.getDashboardData();
      res.json(dashboard);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };
}
