// src/api/controllers/transaction.controller.ts
import { Request, Response } from 'express';
import { TransactionManager } from '../../lib/payment/transaction/managers/transaction.manager';
import { HealthChecker } from '../../lib/payment/monitoring/health/checker';
import { MetricsCollector } from '../../lib/payment/monitoring/metrics/collector';
import { AlertDetector } from '../../lib/payment/monitoring/alerts/detector';
import { TransactionType, TransactionStatus } from '../../lib/payment/types/transaction.types';

export class TransactionController {
  constructor(
    private transactionManager: TransactionManager,
    private healthChecker: HealthChecker,
    private metricsCollector: MetricsCollector,
    private alertDetector: AlertDetector
  ) {}

  // Transaction endpoints
  createTransaction = async (req: Request, res: Response): Promise<void> => {
    try {
      const transaction = await this.transactionManager.beginTransaction(
        req.body.type as TransactionType,
        {
          amount: req.body.amount,
          currency: req.body.currency,
          customerId: req.user.id,
          paymentMethodId: req.body.paymentMethodId,
          idempotencyKey: req.headers['idempotency-key'] as string,
          metadata: req.body.metadata
        }
      );

      this.metricsCollector.record('transaction.created', 1, {
        type: transaction.type,
        status: transaction.status
      });

      res.status(201).json(transaction);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  getTransaction = async (req: Request, res: Response): Promise<void> => {
    try {
      const transaction = await this.transactionManager.getTransaction(req.params.id);
      if (!transaction) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }

      if (transaction.customerId !== req.user.id) {
        res.status(403).json({ error: 'Unauthorized access' });
        return;
      }

      res.json(transaction);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  listTransactions = async (req: Request, res: Response): Promise<void> => {
    try {
      const transactions = await this.transactionManager.listTransactions(
        req.user.id,
        {
          status: req.query.status as TransactionStatus,
          type: req.query.type as TransactionType,
          startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
          endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
          limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
          offset: req.query.offset ? parseInt(req.query.offset as string) : undefined
        }
      );

      res.json(transactions);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  retryTransaction = async (req: Request, res: Response): Promise<void> => {
    try {
      const transaction = await this.transactionManager.getTransaction(req.params.id);
      if (!transaction) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }

      if (transaction.customerId !== req.user.id) {
        res.status(403).json({ error: 'Unauthorized access' });
        return;
      }

      const updatedTransaction = await this.transactionManager.handleTransactionError(
        transaction.id,
        {
          code: 'RETRY_REQUESTED',
          message: 'Manual retry requested',
          recoverable: true,
          retryable: true
        }
      );

      this.metricsCollector.record('transaction.retry', 1, {
        type: transaction.type,
        status: transaction.status
      });

      res.json(updatedTransaction);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  recoverTransaction = async (req: Request, res: Response): Promise<void> => {
    try {
      const transaction = await this.transactionManager.getTransaction(req.params.id);
      if (!transaction) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }

      if (transaction.customerId !== req.user.id) {
        res.status(403).json({ error: 'Unauthorized access' });
        return;
      }

      const updatedTransaction = await this.transactionManager.handleTransactionError(
        transaction.id,
        {
          code: 'RECOVERY_REQUESTED',
          message: 'Manual recovery requested',
          recoverable: true,
          retryable: false
        }
      );

      this.metricsCollector.record('transaction.recovery', 1, {
        type: transaction.type,
        status: transaction.status
      });

      res.json(updatedTransaction);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  rollbackTransaction = async (req: Request, res: Response): Promise<void> => {
    try {
      const transaction = await this.transactionManager.getTransaction(req.params.id);
      if (!transaction) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }

      if (transaction.customerId !== req.user.id) {
        res.status(403).json({ error: 'Unauthorized access' });
        return;
      }

      const updatedTransaction = await this.transactionManager.rollbackTransaction(
        transaction.id
      );

      this.metricsCollector.record('transaction.rollback', 1, {
        type: transaction.type,
        status: transaction.status
      });

      res.json(updatedTransaction);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  // Monitoring endpoints
  getHealthStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const health = await this.healthChecker.check();
      const statusCode = health.status === 'UP' ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  getMetrics = async (req: Request, res: Response): Promise<void> => {
    try {
      const metrics = this.metricsCollector.getAllMetrics();
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  getAlerts = async (req: Request, res: Response): Promise<void> => {
    try {
      const alerts = this.alertDetector.getActiveAlerts();
      res.json(alerts);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  acknowledgeAlert = async (req: Request, res: Response): Promise<void> => {
    try {
      this.alertDetector.acknowledgeAlert(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };
}
