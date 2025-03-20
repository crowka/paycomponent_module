// src/lib/payment/transaction/store/database-transaction.store.ts
import { Pool } from 'pg';
import { 
  Transaction, 
  TransactionStatus, 
  TransactionType 
} from '../../types/transaction.types';
import { TransactionStore, TransactionQuery } from './transaction.store';
import { errorHandler, ErrorCode } from '../../utils/error';
import { PaymentLogger } from '../../utils/logger';

export class DatabaseTransactionStore extends TransactionStore {
  private logger: PaymentLogger;
  
  constructor(private dbPool: Pool) {
    super();
    this.logger = new PaymentLogger('info', 'DatabaseTransactionStore');
  }

  async save(transaction: Transaction): Promise<void> {
    try {
      const query = `
        INSERT INTO transactions (
          id, type, status, amount, currency, customer_id, payment_method_id,
          idempotency_key, retry_count, metadata, error, created_at, updated_at,
          completed_at, failed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO UPDATE SET
          status = $3,
          retry_count = $9,
          metadata = $10,
          error = $11,
          updated_at = $13,
          completed_at = $14,
          failed_at = $15
      `;

      await this.dbPool.query(query, [
        transaction.id,
        transaction.type,
        transaction.status,
        transaction.amount,
        transaction.currency,
        transaction.customerId,
        transaction.paymentMethodId,
        transaction.idempotencyKey,
        transaction.retryCount,
        transaction.metadata ? JSON.stringify(transaction.metadata) : null,
        transaction.error ? JSON.stringify(transaction.error) : null,
        transaction.createdAt,
        transaction.updatedAt,
        transaction.completedAt,
        transaction.failedAt
      ]);
      
      this.logger.debug('Transaction saved', { 
        transactionId: transaction.id,
        status: transaction.status
      });
    } catch (error) {
      this.logger.error('Failed to save transaction', { 
        error, 
        transactionId: transaction.id
      });
      
      throw errorHandler.wrapError(
        error,
        'Failed to save transaction',
        ErrorCode.DATABASE_ERROR,
        { transactionId: transaction.id }
      );
    }
  }

  async get(id: string): Promise<Transaction | null> {
    try {
      const result = await this.dbPool.query(
        'SELECT * FROM transactions WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToTransaction(result.rows[0]);
    } catch (error) {
      this.logger.error('Failed to get transaction', { error, id });
      
      throw errorHandler.wrapError(
        error,
        'Failed to get transaction',
        ErrorCode.DATABASE_ERROR,
        { transactionId: id }
      );
    }
  }

  async query(
    customerId: string,
    options: TransactionQuery
  ): Promise<Transaction[]> {
    try {
      let query = 'SELECT * FROM transactions WHERE customer_id = $1';
      const params: any[] = [customerId];
      let paramIndex = 2;

      if (options.status) {
        query += ` AND status = $${paramIndex++}`;
        params.push(options.status);
      }

      if (options.type) {
        query += ` AND type = $${paramIndex++}`;
        params.push(options.type);
      }

      if (options.startDate) {
        query += ` AND created_at >= $${paramIndex++}`;
        params.push(options.startDate);
      }

      if (options.endDate) {
        query += ` AND created_at <= $${paramIndex++}`;
        params.push(options.endDate);
      }

      query += ' ORDER BY created_at DESC';

      if (options.limit) {
        query += ` LIMIT $${paramIndex++}`;
        params.push(options.limit);
      }

      if (options.offset) {
        query += ` OFFSET $${paramIndex++}`;
        params.push(options.offset);
      }

      const result = await this.dbPool.query(query, params);
      return result.rows.map(row => this.mapRowToTransaction(row));
    } catch (error) {
      this.logger.error('Failed to query transactions', { 
        error, 
        customerId,
        options
      });
      
      throw errorHandler.wrapError(
        error,
        'Failed to query transactions',
        ErrorCode.DATABASE_ERROR,
        { customerId }
      );
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.dbPool.query('DELETE FROM transactions WHERE id = $1', [id]);
    } catch (error) {
      this.logger.error('Failed to delete transaction', { error, id });
      
      throw errorHandler.wrapError(
        error,
        'Failed to delete transaction',
        ErrorCode.DATABASE_ERROR,
        { transactionId: id }
      );
    }
  }

  async findByIdempotencyKey(key: string): Promise<Transaction | null> {
    try {
      const result = await this.dbPool.query(
        'SELECT * FROM transactions WHERE idempotency_key = $1',
        [key]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToTransaction(result.rows[0]);
    } catch (error) {
      this.logger.error('Failed to find transaction by idempotency key', { 
        error, 
        key 
      });
      
      throw errorHandler.wrapError(
        error,
        'Failed to find transaction by idempotency key',
        ErrorCode.DATABASE_ERROR,
        { idempotencyKey: key }
      );
    }
  }

  async queryAll(options: TransactionQuery): Promise<Transaction[]> {
    try {
      let query = 'SELECT * FROM transactions WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;

      if (options.status) {
        query += ` AND status = $${paramIndex++}`;
        params.push(options.status);
      }

      if (options.type) {
        query += ` AND type = $${paramIndex++}`;
        params.push(options.type);
      }

      if (options.startDate) {
        query += ` AND created_at >= $${paramIndex++}`;
        params.push(options.startDate);
      }

      if (options.endDate) {
        query += ` AND created_at <= $${paramIndex++}`;
        params.push(options.endDate);
      }

      query += ' ORDER BY created_at DESC';

      if (options.limit) {
        query += ` LIMIT $${paramIndex++}`;
        params.push(options.limit);
      }

      if (options.offset) {
        query += ` OFFSET $${paramIndex++}`;
        params.push(options.offset);
      }

      const result = await this.dbPool.query(query, params);
      return result.rows.map(row => this.mapRowToTransaction(row));
    } catch (error) {
      this.logger.error('Failed to query all transactions', { 
        error, 
        options 
      });
      
      throw errorHandler.wrapError(
        error,
        'Failed to query all transactions',
        ErrorCode.DATABASE_ERROR
      );
    }
  }

  private mapRowToTransaction(row: any): Transaction {
    return {
      id: row.id,
      type: row.type as TransactionType,
      status: row.status as TransactionStatus,
      amount: parseFloat(row.amount),
      currency: row.currency,
      customerId: row.customer_id,
      paymentMethodId: row.payment_method_id,
      idempotencyKey: row.idempotency_key,
      retryCount: row.retry_count,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      error: row.error ? JSON.parse(row.error) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      failedAt: row.failed_at
    };
  }
}
