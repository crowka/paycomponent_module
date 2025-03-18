// src/api/middleware/data-validation.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { PaymentLogger } from '../../lib/payment/utils/logger';
import { errorHandler, ErrorCode } from '../../lib/payment/utils/error';

const logger = new PaymentLogger('info', 'DataValidationMiddleware');

// Data validation middleware factory
export const createDataValidationMiddleware = (connection: any) => {
  // Validate customer existence
  const validateCustomer = async (
    req: Request, 
    res: Response, 
    next: NextFunction
  ): Promise<void> => {
    try {
      const customerId = req.params.customerId || req.body.customerId || req.user?.id;
      
      if (!customerId) {
        logger.warn('Customer ID is missing');
        return res.status(400).json({
          error: 'Customer ID is required',
          code: ErrorCode.VALIDATION_ERROR
        });
      }
      
      // Check if customer exists in database
      const query = 'SELECT id FROM customers WHERE id = $1';
      const result = await connection.query(query, [customerId]);
      
      if (!result.rows || result.rows.length === 0) {
        logger.warn('Customer not found', { customerId });
        return res.status(404).json({
          error: 'Customer not found',
          code: ErrorCode.CUSTOMER_NOT_FOUND
        });
      }
      
      // Store customer in request for later use
      req.customer = { id: customerId };
      next();
    } catch (error) {
      logger.error('Error validating customer', { error });
      next(error);
    }
  };
  
  // Validate payment method existence and ownership
  const validatePaymentMethod = async (
    req: Request, 
    res: Response, 
    next: NextFunction
  ): Promise<void> => {
    try {
      const paymentMethodId = req.params.paymentMethodId || req.body.paymentMethodId;
      const customerId = req.user?.id;
      
      if (!paymentMethodId) {
        logger.warn('Payment method ID is missing');
        return res.status(400).json({
          error: 'Payment method ID is required',
          code: ErrorCode.VALIDATION_ERROR
        });
      }
      
      // Check if payment method exists and belongs to customer
      const query = `
        SELECT id FROM payment_methods 
        WHERE id = $1 AND customer_id = $2
      `;
      
      const result = await connection.query(query, [paymentMethodId, customerId]);
      
      if (!result.rows || result.rows.length === 0) {
        logger.warn('Payment method not found or does not belong to customer', { 
          paymentMethodId, 
          customerId 
        });
        
        return res.status(404).json({
          error: 'Payment method not found',
          code: ErrorCode.PAYMENT_METHOD_INVALID
        });
      }
      
      // Store payment method in request for later use
      req.paymentMethod = { id: paymentMethodId };
      next();
    } catch (error) {
      logger.error('Error validating payment method', { error });
      next(error);
    }
  };
  
  // Validate transaction existence and ownership
  const validateTransaction = async (
    req: Request, 
    res: Response, 
    next: NextFunction
  ): Promise<void> => {
    try {
      const transactionId = req.params.transactionId || req.body.transactionId;
      const customerId = req.user?.id;
      
      if (!transactionId) {
        logger.warn('Transaction ID is missing');
        return res.status(400).json({
          error: 'Transaction ID is required',
          code: ErrorCode.VALIDATION_ERROR
        });
      }
      
      // Check if transaction exists and belongs to customer
      const query = `
        SELECT id, status FROM transactions 
        WHERE id = $1 AND customer_id = $2
      `;
      
      const result = await connection.query(query, [transactionId, customerId]);
      
      if (!result.rows || result.rows.length === 0) {
        logger.warn('Transaction not found or does not belong to customer', { 
          transactionId, 
          customerId 
        });
        
        return res.status(404).json({
          error: 'Transaction not found',
          code: ErrorCode.TRANSACTION_NOT_FOUND
        });
      }
      
      // Store transaction in request for later use
      req.transaction = {
        id: transactionId,
        status: result.rows[0].status
      };
      
      next();
    } catch (error) {
      logger.error('Error validating transaction', { error });
      next(error);
    }
  };
  
  // Check database consistency
  const checkDatabaseConsistency = async (
    req: Request, 
    res: Response, 
    next: NextFunction
  ): Promise<void> => {
    // This middleware would be used sparingly on critical operations
    try {
      logger.info('Checking database consistency');
      
      // Check for orphaned records
      const orphanedPaymentMethods = await connection.query(`
        SELECT COUNT(*) FROM payment_methods pm
        LEFT JOIN customers c ON pm.customer_id = c.id
        WHERE c.id IS NULL
      `);
      
      const orphanedTransactions = await connection.query(`
        SELECT COUNT(*) FROM transactions t
        LEFT JOIN customers c ON t.customer_id = c.id
        WHERE c.id IS NULL
      `);
      
      if (
        parseInt(orphanedPaymentMethods.rows[0].count) > 0 ||
        parseInt(orphanedTransactions.rows[0].count) > 0
      ) {
        logger.error('Database inconsistency detected', {
          orphanedPaymentMethods: orphanedPaymentMethods.rows[0].count,
          orphanedTransactions: orphanedTransactions.rows[0].count
        });
        
        return res.status(500).json({
          error: 'System temporarily unavailable due to maintenance',
          code: 'SYSTEM_MAINTENANCE'
        });
      }
      
      next();
    } catch (error) {
      logger.error('Error checking database consistency', { error });
      next(error);
    }
  };
  
  return {
    validateCustomer,
    validatePaymentMethod,
    validateTransaction,
    checkDatabaseConsistency
  };
};
