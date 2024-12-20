// src/api/controllers/compliance.controller.ts
import { Request, Response } from 'express';
import { ComplianceManager } from '../../lib/payment/compliance/compliance.manager';
import { AuditManager } from '../../lib/payment/compliance/audit.manager';

export class ComplianceController {
  constructor(
    private complianceManager: ComplianceManager,
    private auditManager: AuditManager
  ) {}

  getRules = async (req: Request, res: Response): Promise<void> => {
    try {
      const rules = await this.complianceManager.getRules();
      res.json(rules);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  validateCompliance = async (req: Request, res: Response): Promise<void> => {
    try {
      const { data, categories } = req.body;
      const validation = await this.complianceManager.validateCompliance(
        data,
        categories
      );
      res.json(validation);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  getAuditLogs = async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        entityType,
        entityId,
        userId,
        startDate,
        endDate,
        limit,
        offset,
        type
      } = req.query;

      const logs = await this.auditManager.getLogs({
        entityType: entityType as string,
        entityId: entityId as string,
        userId: userId as string,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
        type: type as string
      });

      res.json(logs);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  exportAuditReport = async (req: Request, res: Response): Promise<void> => {
    try {
      const { format, dateRange } = req.query;
      const report = await this.auditManager.generateReport({
        format: format as 'pdf' | 'csv',
        dateRange: {
          startDate: new Date((dateRange as any).startDate),
          endDate: new Date((dateRange as any).endDate)
        }
      });

      res.setHeader('Content-Type', this.getContentType(format as string));
      res.setHeader('Content-Disposition', `attachment; filename=audit-report.${format}`);
      res.send(report);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  private getContentType(format: string): string {
    switch (format) {
      case 'pdf':
        return 'application/pdf';
      case 'csv':
        return 'text/csv';
      default:
        return 'application/json';
    }
  }
}