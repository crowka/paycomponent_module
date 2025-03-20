// src/api/controllers/transaction.controller.ts

import { Request, Response } from 'express';
import { TransactionManager } from '../../lib/payment/transaction/managers/transaction.manager';
import { RetryManager } from '../../lib/payment/transaction/managers/retry.manager';
import { 
  TransactionStatus, 
  TransactionType
} from '../../lib/payment/types/transaction.types';
import { validateRequest } from '../middleware/validation.middleware';
import { transactionSchema } from '../validation/schemas';
import { errorHandler } from '../../lib/payment/utils/error';
import { PaymentLogger } from '../../lib/payment/utils/logger';

export class TransactionController {
  private logger: PaymentLogger;

  constructor(
    private transactionManager: TransactionManager,
    private retryManager?: RetryManager
  ) {
    this.logger = new PaymentLogger('info', 'TransactionController');
  }

  /**
   * Create a new transaction
   */
  createTransaction = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request using schema
      const validationResult = transactionSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({
          success: false,
          error: {
            code: 'validation_error',
            message: 'Invalid transaction data',
            details: validationResult.error.format()
          }
        });
        return;
      }
      
      const data = validationResult.data;
      
      // Add request ID to context for tracing
      const requestId = req.headers['x-request-id'] || `req-${Date.now()}`;
      
      this.logger.info(`Creating transaction`, {
        requestId,
        type: data.type,
        amount: data.amount,
        currency: data.currency,
        customerId: data.customerId
      });
      
      // Create transaction
      const transaction = await this.transactionManager.beginTransaction(
        data.type as TransactionType,
        {
          amount: data.amount,
          currency: data.currency,
          customerId: data.customerId,
          paymentMethodId: data.paymentMethodId,
          idempotencyKey: data.idempotencyKey,
          metadata: data.metadata
        }
      );
      
      // Return success response
      res.status(201).json({
        success: true,
        transaction: {
          id: transaction.id,
          status: transaction.status,
          amount: transaction.amount,
          currency: transaction.currency,
          createdAt: transaction.createdAt
        }
      });
    } catch (error) {
      this.logger.error('Error creating transaction', { error });
      
      // Format and return error response
      const errorResponse = errorHandler.handleControllerError(
        error,
        'Failed to create transaction'
      );
      
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  }

  /**
   * Get a transaction by ID
   */
  getTransaction = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      
      this.logger.info(`Getting transaction ${id}`);
      
      // Get transaction
      const transaction = await this.transactionManager.getTransaction(id);
      
      if (!transaction) {
        res.status(404).json({
          success: false,
          error: {
            code: 'transaction_not_found',
            message: `Transaction ${id} not found`
          }
        });
        return;
      }
      
      // Return transaction data
      res.status(200).json({
        success: true,
        transaction: {
          id: transaction.id,
          status: transaction.status,
          type: transaction.type,
          amount: transaction.amount,
          currency: transaction.currency,
          customerId: transaction.customerId,
          paymentMethodId: transaction.paymentMethodId,
          retryCount: transaction.retryCount,
          createdAt: transaction.createdAt,
          updatedAt: transaction.updatedAt,
          completedAt: transaction.completedAt,
          failedAt: transaction.failedAt,
          metadata: transaction.metadata
        }
      });
    } catch (error) {
      this.logger.error(`Error getting transaction`, { error, transactionId: req.params.id });
      
      // Format and return error response
      const errorResponse = errorHandler.handleControllerError(
        error,
        'Failed to get transaction'
      );
      
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  }

  /**
   * Get transactions for a customer
   */
  getTransactions = async (req: Request, res: Response): Promise<void> => {
    try {
      const { customerId } = req.params;
      const { status, type, startDate, endDate, limit, offset } = req.query;
      
      this.logger.info(`Getting transactions for customer ${customerId}`, {
        status, type, startDate, endDate, limit, offset
      });
      
      // Parse query parameters
      const options: any = {};
      
      if (status) {
        options.status = status as TransactionStatus;
      }
      
      if (type) {
        options.type = type as TransactionType;
      }
      
      if (startDate) {
        options.startDate = new Date(startDate as string);
      }
      
      if (endDate) {
        options.endDate = new Date(endDate as string);
      }
      
      if (limit) {
        options.limit = parseInt(limit as string);
      }
      
      if (offset) {
        options.offset = parseInt(offset as string);
      }
      
      // Get transactions
      const transactions = await this.transactionManager.getTransactions(
        customerId,
        options
      );
      
      // Return transactions
      res.status(200).json({
        success: true,
        transactions: transactions.map(tx => ({
          id: tx.id,
          status: tx.status,
          type: tx.type,
          amount: tx.amount,
          currency: tx.currency,
          retryCount: tx.retryCount,
          createdAt: tx.createdAt,
          updatedAt: tx.updatedAt
        }))
      });
    } catch (error) {
      this.logger.error(`Error getting transactions`, { 
        error, 
        customerId: req.params.customerId 
      });
      
      // Format and return error response
      const errorResponse = errorHandler.handleControllerError(
        error,
        'Failed to get transactions'
      );
      
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  }

  /**
   * Update transaction status
   */
  updateTransactionStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { status, metadata } = req.body;
      
      this.logger.info(`Updating transaction ${id} status to ${status}`);
      
      // Validate status
      if (!Object.values(TransactionStatus).includes(status)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'invalid_status',
            message: `Invalid status: ${status}`
          }
        });
        return;
      }
      
      // Update status
      const transaction = await this.transactionManager.updateTransactionStatus(
        id,
        status as TransactionStatus,
        metadata
      );
      
      // Return updated transaction
      res.status(200).json({
        success: true,
        transaction: {
          id: transaction.id,
          status: transaction.status,
          updatedAt: transaction.updatedAt
        }
      });
    } catch (error) {
      this.logger.error(`Error updating transaction status`, { 
        error, 
        transactionId: req.params.id,
        status: req.body.status
      });
      
      // Format and return error response
      const errorResponse = errorHandler.handleControllerError(
        error,
        'Failed to update transaction status'
      );
      
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  }

  /**
   * Retry a failed transaction
   */
  retryTransaction = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      
      this.logger.info(`Manually retrying transaction ${id}`);
      
      // Check if retry manager is available
      if (!this.retryManager) {
        res.status(500).json({
          success: false,
          error: {
            code: 'retry_unavailable',
            message: 'Retry functionality is not available'
          }
        });
        return;
      }
      
      // Get transaction first
      const transaction = await this.transactionManager.getTransaction(id);
      
      if (!transaction) {
        res.status(404).json({
          success: false,
          error: {
            code: 'transaction_not_found',
            message: `Transaction ${id} not found`
          }
        });
        return;
      }
      
      // Check if transaction can be retried
      if (transaction.status !== TransactionStatus.FAILED) {
        res.status(400).json({
          success: false,
          error: {
            code: 'invalid_transaction_state',
            message: `Cannot retry transaction in ${transaction.status} state`
          }
        });
        return;
      }
      
      // Schedule retry
      const updatedTransaction = await this.retryManager.scheduleRetry(
        transaction,
        transaction.error || {
          code: 'MANUAL_RETRY',
          message: 'Manual retry requested',
          recoverable: true,
          retryable: true
        }
      );
      
      // Return updated transaction
      res.status(200).json({
        success: true,
        transaction: {
          id: updatedTransaction.id,
          status: updatedTransaction.status,
          retryCount: updatedTransaction.retryCount,
          updatedAt: updatedTransaction.updatedAt,
          metadata: updatedTransaction.metadata
        }
      });
    } catch (error) {
      this.logger.error(`Error retrying transaction`, { 
        error, 
        transactionId: req.params.id 
      });
      
      // Format and return error response
      const errorResponse = errorHandler.handleControllerError(
        error,
        'Failed to retry transaction'
      );
      
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  }

  /**
   * Get retry statistics
   */
  getRetryStats = async (req: Request, res: Response): Promise<void> => {
    try {
      this.logger.info('Getting retry statistics');
      
      // Check if retry manager is available
      if (!this.retryManager) {
        res.status(500).json({
          success: false,
          error: {
            code: 'retry_unavailable',
            message: 'Retry functionality is not available'
          }
        });
        return;
      }
      
      // Get stats
      const stats = await this.retryManager.getRetryStats();
      
      // Return stats
      res.status(200).json({
        success: true,
        stats
      });
    } catch (error) {
      this.logger.error('Error getting retry statistics', { error });
      
      // Format and return error response
      const errorResponse = errorHandler.handleControllerError(
        error,
        'Failed to get retry statistics'
      );
      
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  }

  /**
   * Cancel a pending retry
   */
  cancelRetry = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      
      this.logger.info(`Cancelling retry for transaction ${id}`);
      
      // Check if retry manager is available
      if (!this.retryManager) {
        res.status(500).json({
          success: false,
          error: {
            code: 'retry_unavailable',
            message: 'Retry functionality is not available'
          }
        });
        return;
      }
      
      // Cancel retry
      const success = await this.retryManager.cancelRetry(id);
      
      if (!success) {
        res.status(404).json({
          success: false,
          error: {
            code: 'retry_not_found',
            message: `No pending retry found for transaction ${id}`
          }
        });
        return;
      }
      
      // Return success
      res.status(200).json({
        success: true,
        message: `Retry cancelled for transaction ${id}`
      });
    } catch (error) {
      this.logger.error(`Error cancelling retry`, { 
        error, 
        transactionId: req.params.id 
      });
      
      // Format and return error response
      const errorResponse = errorHandler.handleControllerError(
        error,
        'Failed to cancel retry'
      );
      
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  }
}
