// src/lib/payment/database/consistency.checker.ts
import { PaymentLogger } from '../utils/logger';
import { errorHandler, ErrorCode } from '../utils/error';

export interface ConsistencyIssue {
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affected: {
    table: string;
    records: number;
  };
  query?: string;
}

export class ConsistencyChecker {
  private logger: PaymentLogger;
  
  constructor(private connection: any) {
    this.logger = new PaymentLogger('info', 'ConsistencyChecker');
  }

  async checkDatabaseConsistency(): Promise<{
    issues: ConsistencyIssue[];
    isConsistent: boolean;
  }> {
    const issues: ConsistencyIssue[] = [];
    
    try {
      this.logger.info('Starting database consistency check');
      
      // Check for orphaned payment methods
      await this.checkOrphanedRecords(issues, {
        table: 'payment_methods',
        foreignKey: 'customer_id',
        referencedTable: 'customers',
        referencedKey: 'id',
        description: 'Payment methods without associated customer'
      });
      
      // Check for orphaned transactions
      await this.checkOrphanedRecords(issues, {
        table: 'transactions',
        foreignKey: 'customer_id',
        referencedTable: 'customers',
        referencedKey: 'id',
        description: 'Transactions without associated customer'
      });
      
      // Check for orphaned transactions (payment method)
      await this.checkOrphanedRecords(issues, {
        table: 'transactions',
        foreignKey: 'payment_method_id',
        referencedTable: 'payment_methods',
        referencedKey: 'id',
        description: 'Transactions without associated payment method'
      });
      
      // Check for duplicate idempotency keys
      await this.checkDuplicates(issues, {
        table: 'transactions',
        column: 'idempotency_key',
        description: 'Duplicate idempotency keys'
      });
      
      // Check for default payment methods consistency
      await this.checkDefaultPaymentMethods(issues);
      
      // Check for transactions in invalid state
      await this.checkInvalidTransactionStates(issues);
      
      this.logger.info('Database consistency check completed', {
        issueCount: issues.length,
        isConsistent: issues.length === 0
      });
      
      return {
        issues,
        isConsistent: issues.length === 0
      };
    } catch (error) {
      this.logger.error('Error during database consistency check', { error });
      throw errorHandler.wrapError(
        error,
        'Database consistency check failed',
        ErrorCode.DATABASE_ERROR
      );
    }
  }

  private async checkOrphanedRecords(
    issues: ConsistencyIssue[],
    options: {
      table: string;
      foreignKey: string;
      referencedTable: string;
      referencedKey: string;
      description: string;
    }
  ): Promise<void> {
    const { table, foreignKey, referencedTable, referencedKey, description } = options;
    
    const query = `
      SELECT COUNT(*) FROM ${table} t
      LEFT JOIN ${referencedTable} r ON t.${foreignKey} = r.${referencedKey}
      WHERE r.${referencedKey} IS NULL
    `;
    
    const result = await this.connection.query(query);
    const count = parseInt(result.rows[0].count);
    
    if (count > 0) {
      issues.push({
        type: 'orphaned_records',
        description,
        severity: 'high',
        affected: {
          table,
          records: count
        },
        query
      });
      
      this.logger.warn(description, { count, table });
    }
  }

  private async checkDuplicates(
    issues: ConsistencyIssue[],
    options: {
      table: string;
      column: string;
      description: string;
    }
  ): Promise<void> {
    const { table, column, description } = options;
    
    const query = `
      SELECT ${column}, COUNT(*) as count
      FROM ${table}
      GROUP BY ${column}
      HAVING COUNT(*) > 1
    `;
    
    const result = await this.connection.query(query);
    
    if (result.rows.length > 0) {
      const totalDuplicates = result.rows.reduce(
        (sum: number, row: any) => sum + parseInt(row.count) - 1, 
        0
      );
      
      issues.push({
        type: 'duplicate_records',
        description,
        severity: 'critical',
        affected: {
          table,
          records: totalDuplicates
        },
        query
      });
      
      this.logger.warn(description, { 
        count: totalDuplicates, 
        table, 
        column 
      });
    }
  }

  private async checkDefaultPaymentMethods(
    issues: ConsistencyIssue[]
  ): Promise<void> {
    // Check for customers with multiple default payment methods
    const multipleDefaultsQuery = `
      SELECT customer_id, COUNT(*) as count
      FROM payment_methods
      WHERE is_default = true
      GROUP BY customer_id
      HAVING COUNT(*) > 1
    `;
    
    const multipleDefaultsResult = await this.connection.query(multipleDefaultsQuery);
    
    if (multipleDefaultsResult.rows.length > 0) {
      const totalAffected = multipleDefaultsResult.rows.length;
      
      issues.push({
        type: 'multiple_defaults',
        description: 'Customers with multiple default payment methods',
        severity: 'medium',
        affected: {
          table: 'payment_methods',
          records: totalAffected
        },
        query: multipleDefaultsQuery
      });
      
      this.logger.warn('Customers with multiple default payment methods', { 
        count: totalAffected 
      });
    }
    
    // Check for active customers without any default payment method
    const noDefaultQuery = `
      SELECT c.id
      FROM customers c
      LEFT JOIN (
        SELECT customer_id
        FROM payment_methods
        WHERE is_default = true
      ) pm ON c.id = pm.customer_id
      WHERE pm.customer_id IS NULL
      AND c.status = 'active'
    `;
    
    const noDefaultResult = await this.connection.query(noDefaultQuery);
    
    if (noDefaultResult.rows.length > 0) {
      issues.push({
        type: 'missing_default',
        description: 'Active customers without default payment method',
        severity: 'low',
        affected: {
          table: 'customers',
          records: noDefaultResult.rows.length
        },
        query: noDefaultQuery
      });
      
      this.logger.warn('Active customers without default payment method', { 
        count: noDefaultResult.rows.length 
      });
    }
  }

  private async checkInvalidTransactionStates(
    issues: ConsistencyIssue[]
  ): Promise<void> {
    // Check for transactions stuck in intermediate states
    const stuckTransactionsQuery = `
      SELECT status, COUNT(*) as count
      FROM transactions
      WHERE status IN ('PENDING', 'PROCESSING', 'RECOVERY_PENDING', 'RECOVERY_IN_PROGRESS')
      AND created_at < NOW() - INTERVAL '24 hours'
      GROUP BY status
    `;
    
    const stuckTransactionsResult = await this.connection.query(stuckTransactionsQuery);
    
    if (stuckTransactionsResult.rows.length > 0) {
      const totalStuck = stuckTransactionsResult.rows.reduce(
        (sum: number, row: any) => sum + parseInt(row.count), 
        0
      );
      
      issues.push({
        type: 'stuck_transactions',
        description: 'Transactions stuck in intermediate states for over 24 hours',
        severity: 'high',
        affected: {
          table: 'transactions',
          records: totalStuck
        },
        query: stuckTransactionsQuery
      });
      
      this.logger.warn('Stuck transactions detected', { 
        count: totalStuck, 
        states: stuckTransactionsResult.rows.map((r: any) => r.status).join(', ') 
      });
    }
  }

  async fixConsistencyIssues(issues: ConsistencyIssue[]): Promise<{
    fixed: ConsistencyIssue[];
    failed: ConsistencyIssue[];
  }> {
    const fixed: ConsistencyIssue[] = [];
    const failed: ConsistencyIssue[] = [];
    
    try {
      this.logger.info('Starting to fix consistency issues', { count: issues.length });
      
      // Begin transaction
      await this.connection.query('BEGIN');
      
      for (const issue of issues) {
        try {
          switch (issue.type) {
            case 'orphaned_records':
              await this.fixOrphanedRecords(issue);
              fixed.push(issue);
              break;
            
            case 'multiple_defaults':
              await this.fixMultipleDefaults(issue);
              fixed.push(issue);
              break;
            
            case 'stuck_transactions':
              await this.fixStuckTransactions(issue);
              fixed.push(issue);
              break;
              
            default:
              this.logger.warn(`No fix implemented for issue type: ${issue.type}`);
              failed.push(issue);
          }
        } catch (error) {
          this.logger.error(`Failed to fix issue: ${issue.description}`, { error });
          failed.push(issue);
        }
      }
      
      // Commit transaction if there were no failures
      if (failed.length === 0) {
        await this.connection.query('COMMIT');
      } else {
        await this.connection.query('ROLLBACK');
        throw new Error(`Failed to fix ${failed.length} issues`);
      }
      
      this.logger.info('Completed fixing consistency issues', {
        fixed: fixed.length,
        failed: failed.length
      });
      
      return { fixed, failed };
    } catch (error) {
      // Ensure transaction is rolled back
      try {
        await this.connection.query('ROLLBACK');
      } catch (rollbackError) {
        this.logger.error('Error during rollback', { error: rollbackError });
      }
      
      this.logger.error('Error fixing consistency issues', { error });
      
      throw errorHandler.wrapError(
        error,
        'Failed to fix database consistency issues',
        ErrorCode.DATABASE_ERROR
      );
    }
  }

  private async fixOrphanedRecords(issue: ConsistencyIssue): Promise<void> {
    // This is a simple implementation that just deletes orphaned records
    // In a real system, you might want more sophisticated handling
    const table = issue.affected.table;
    
    this.logger.info(`Fixing orphaned records in ${table}`, {
      count: issue.affected.records
    });
    
    // Extract the JOIN condition from the query
    const match = issue.query?.match(/LEFT JOIN (\w+) \w+ ON (\w+)\.(\w+) = \w+\.(\w+)/);
    
    if (!match) {
      throw new Error(`Cannot parse JOIN condition from query: ${issue.query}`);
    }
    
    const [_, referencedTable, sourceTable, foreignKey, referencedKey] = match;
    
    const deleteQuery = `
      DELETE FROM ${table}
      WHERE id IN (
        SELECT t.id FROM ${table} t
        LEFT JOIN ${referencedTable} r ON t.${foreignKey} = r.${referencedKey}
        WHERE r.${referencedKey} IS NULL
      )
    `;
    
    const result = await this.connection.query(deleteQuery);
    this.logger.info(`Deleted ${result.rowCount} orphaned records from ${table}`);
  }

  private async fixMultipleDefaults(issue: ConsistencyIssue): Promise<void> {
    this.logger.info('Fixing customers with multiple default payment methods');
    
    // First, find all affected customers
    const findQuery = `
      SELECT customer_id
      FROM payment_methods
      WHERE is_default = true
      GROUP BY customer_id
      HAVING COUNT(*) > 1
    `;
    
    const customers = await this.connection.query(findQuery);
    
    // For each customer, keep only the newest payment method as default
    for (const row of customers.rows) {
      const customerId = row.customer_id;
      
      const updateQuery = `
        UPDATE payment_methods
        SET is_default = false
        WHERE customer_id = $1
        AND is_default = true
        AND id NOT IN (
          SELECT id
          FROM payment_methods
          WHERE customer_id = $1
          AND is_default = true
          ORDER BY created_at DESC
          LIMIT 1
        )
      `;
      
      const result = await this.connection.query(updateQuery, [customerId]);
      this.logger.info(`Fixed default payment methods for customer: ${customerId}`, {
        updated: result.rowCount
      });
    }
  }

  private async fixStuckTransactions(issue: ConsistencyIssue): Promise<void> {
    this.logger.info('Fixing stuck transactions');
    
    // Mark long-pending transactions as failed
    const updateQuery = `
      UPDATE transactions
      SET 
        status = 'FAILED',
        error = jsonb_build_object(
          'code', 'TRANSACTION_TIMEOUT',
          'message', 'Transaction timed out after 24 hours',
          'recoverable', false,
          'retryable', false
        ),
        updated_at = NOW(),
        failed_at = NOW()
      WHERE status IN ('PENDING', 'PROCESSING', 'RECOVERY_PENDING', 'RECOVERY_IN_PROGRESS')
      AND created_at < NOW() - INTERVAL '24 hours'
    `;
    
    const result = await this.connection.query(updateQuery);
    this.logger.info(`Marked ${result.rowCount} stuck transactions as failed`);
  }
}
