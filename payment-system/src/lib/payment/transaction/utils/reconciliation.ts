// src/lib/payment/transaction/utils/reconciliation.ts
import { v4 as uuidv4 } from 'uuid';
import { Transaction, TransactionStatus, TransactionType } from '../types';
import { TransactionStore } from '../store/transaction.store';
import { PaymentLogger } from '../../utils/logger';
import { errorHandler, ErrorCode } from '../../utils/error';
import { EventEmitter } from '../../events/event.emitter';

export interface ReconciliationResult {
  id: string;
  timestamp: Date;
  source: 'internal' | 'external';
  transactionsChecked: number;
  mismatches: ReconciliationMismatch[];
  summary: {
    succeeded: number;
    failed: number;
    inProgress: number;
    inconsistent: number;
    orphaned: number;
    missing: number;
  };
}

export interface ReconciliationMismatch {
  transactionId: string;
  type: 'status_mismatch' | 'amount_mismatch' | 'orphaned' | 'missing' | 'duplicate';
  details: Record<string, any>;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ReconciliationOptions {
  startDate?: Date;
  endDate?: Date;
  customerId?: string;
  transactionType?: TransactionType;
  batchSize?: number;
  externalSystemId?: string;
  eventEmitter?: EventEmitter;
}

/**
 * TransactionReconciliator verifies consistency between the internal transaction store
 * and external payment systems, identifies discrepancies, and provides data for
 * reconciliation processes.
 */
export class TransactionReconciliator {
  private logger: PaymentLogger;
  private eventEmitter?: EventEmitter;
  
  constructor(
    private transactionStore: TransactionStore,
    private externalSystemAdapter: ExternalSystemAdapter,
    options: {
      eventEmitter?: EventEmitter;
    } = {}
  ) {
    this.logger = new PaymentLogger('info', 'TransactionReconciliator');
    this.eventEmitter = options.eventEmitter;
  }
  
  /**
   * Perform reconciliation between internal transactions and external system
   */
  async reconcile(options: ReconciliationOptions = {}): Promise<ReconciliationResult> {
    const {
      startDate = new Date(Date.now() - 24 * 60 * 60 * 1000), // Default to last 24 hours
      endDate = new Date(),
      batchSize = 100
    } = options;
    
    const reconciliationId = uuidv4();
    this.logger.info(`Starting transaction reconciliation #${reconciliationId}`, {
      startDate,
      endDate,
      customerId: options.customerId,
      transactionType: options.transactionType
    });
    
    try {
      // Step 1: Fetch internal transactions
      const internalTransactions = await this.fetchInternalTransactions(options);
      
      // Step 2: Fetch corresponding external transactions
      const externalTransactions = await this.fetchExternalTransactions(
        internalTransactions,
        options.externalSystemId
      );
      
      // Step 3: Compare and identify discrepancies
      const mismatches = await this.compareTransactions(
        internalTransactions,
        externalTransactions
      );
      
      // Step 4: Create reconciliation result
      const summary = this.summarizeReconciliation(
        internalTransactions,
        externalTransactions,
        mismatches
      );
      
      const result: ReconciliationResult = {
        id: reconciliationId,
        timestamp: new Date(),
        source: 'internal',
        transactionsChecked: internalTransactions.length,
        mismatches,
        summary
      };
      
      this.logger.info(`Completed reconciliation #${reconciliationId}`, {
        transactionsChecked: result.transactionsChecked,
        mismatchCount: result.mismatches.length,
        summary
      });
      
      // Emit reconciliation event
      if (this.eventEmitter) {
        this.eventEmitter.emit('transaction.reconciliation_completed', {
          reconciliationId,
          timestamp: result.timestamp,
          summary: result.summary
        }).catch(error => {
          this.logger.error('Failed to emit reconciliation event', { error });
        });
      }
      
      return result;
    } catch (error) {
      this.logger.error(`Reconciliation #${reconciliationId} failed`, { error });
      
      // Emit failure event
      if (this.eventEmitter) {
        this.eventEmitter.emit('transaction.reconciliation_failed', {
          reconciliationId,
          error: error.message
        }).catch(errEvent => {
          this.logger.error('Failed to emit reconciliation failure event', { error: errEvent });
        });
      }
      
      throw errorHandler.wrapError(
        error,
        'Transaction reconciliation failed',
        ErrorCode.RECONCILIATION_ERROR
      );
    }
  }
  
  /**
   * Fetch internal transactions based on filters
   */
  private async fetchInternalTransactions(
    options: ReconciliationOptions
  ): Promise<Transaction[]> {
    const {
      startDate,
      endDate,
      customerId,
      transactionType,
      batchSize = 100
    } = options;
    
    // Start with reasonable default query if customerId not provided
    const query: any = {};
    
    if (startDate) {
      query.startDate = startDate;
    }
    
    if (endDate) {
      query.endDate = endDate;
    }
    
    if (transactionType) {
      query.type = transactionType;
    }
    
    query.limit = batchSize;
    
    // Fetch transactions
    try {
      let transactions: Transaction[];
      
      if (customerId) {
        transactions = await this.transactionStore.query(customerId, query);
      } else {
        // For reconciliation without customerId, we need a special query method
        // This would typically be a custom method in the store
        transactions = await this.transactionStore.queryAll(query);
      }
      
      this.logger.info(`Fetched ${transactions.length} internal transactions for reconciliation`);
      return transactions;
    } catch (error) {
      this.logger.error('Failed to fetch internal transactions for reconciliation', { error });
      throw error;
    }
  }
  
  /**
   * Fetch corresponding external transactions
   */
  private async fetchExternalTransactions(
    internalTransactions: Transaction[],
    externalSystemId?: string
  ): Promise<ExternalTransaction[]> {
    try {
      // Extract transaction IDs or external references
      const transactionReferences = internalTransactions.map(tx => ({
        internalId: tx.id,
        externalId: tx.metadata?.externalId || tx.id,
        amount: tx.amount,
        currency: tx.currency
      }));
      
      // Fetch from external system
      const externalTransactions = await this.externalSystemAdapter.getTransactions(
        transactionReferences,
        externalSystemId
      );
      
      this.logger.info(`Fetched ${externalTransactions.length} external transactions for reconciliation`);
      return externalTransactions;
    } catch (error) {
      this.logger.error('Failed to fetch external transactions for reconciliation', { error });
      throw error;
    }
  }
  
  /**
   * Compare internal and external transactions to find mismatches
   */
  private async compareTransactions(
    internalTransactions: Transaction[],
    externalTransactions: ExternalTransaction[]
  ): Promise<ReconciliationMismatch[]> {
    const mismatches: ReconciliationMismatch[] = [];
    
    // Create map of external transactions for easy lookup
    const externalMap = new Map<string, ExternalTransaction>();
    for (const tx of externalTransactions) {
      externalMap.set(tx.externalId, tx);
    }
    
    // Check each internal transaction against external
    for (const internalTx of internalTransactions) {
      const externalId = internalTx.metadata?.externalId || internalTx.id;
      const externalTx = externalMap.get(externalId);
      
      // Check if transaction exists in external system
      if (!externalTx) {
        // Only flag as missing if transaction should exist externally
        // Some internal transaction types might not have external representation
        if (this.shouldExistExternally(internalTx)) {
          mismatches.push({
            transactionId: internalTx.id,
            type: 'missing',
            details: {
              internalStatus: internalTx.status,
              internalType: internalTx.type,
              internalAmount: internalTx.amount,
              externalId
            },
            severity: this.getMissingSeverity(internalTx)
          });
        }
        continue;
      }
      
      // Mark as processed to track orphaned transactions later
      externalMap.delete(externalId);
      
      // Check status consistency
      if (!this.isStatusConsistent(internalTx.status, externalTx.status)) {
        mismatches.push({
          transactionId: internalTx.id,
          type: 'status_mismatch',
          details: {
            internalStatus: internalTx.status,
            externalStatus: externalTx.status,
            internalUpdatedAt: internalTx.updatedAt,
            externalUpdatedAt: externalTx.updatedAt
          },
          severity: this.getStatusMismatchSeverity(internalTx.status, externalTx.status)
        });
      }
      
      // Check amount consistency
      if (internalTx.amount !== externalTx.amount) {
        mismatches.push({
          transactionId: internalTx.id,
          type: 'amount_mismatch',
          details: {
            internalAmount: internalTx.amount,
            externalAmount: externalTx.amount,
            difference: internalTx.amount - externalTx.amount,
            currency: internalTx.currency
          },
          severity: 'critical'
        });
      }
    }
    
    // Any remaining external transactions are orphaned (exist in external system but not internally)
    for (const [externalId, externalTx] of externalMap.entries()) {
      mismatches.push({
        transactionId: externalTx.externalId,
        type: 'orphaned',
        details: {
          externalStatus: externalTx.status,
          externalAmount: externalTx.amount,
          externalCurrency: externalTx.currency,
          externalTimestamp: externalTx.updatedAt
        },
        severity: 'high'
      });
    }
    
    return mismatches;
  }
  
  /**
   * Determine if transaction should exist in external system
   */
  private shouldExistExternally(tx: Transaction): boolean {
    // Terminal state transactions should generally exist externally
    if ([
      TransactionStatus.COMPLETED,
      TransactionStatus.FAILED,
      TransactionStatus.ROLLED_BACK
    ].includes(tx.status)) {
      return true;
    }
    
    // If transaction is relatively old but still in progress, it should exist externally
    const hoursSinceCreation = (Date.now() - tx.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceCreation > 1 && [
      TransactionStatus.PENDING,
      TransactionStatus.PROCESSING
    ].includes(tx.status)) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Determine severity of missing transactions
   */
  private getMissingSeverity(tx: Transaction): 'low' | 'medium' | 'high' | 'critical' {
    if (tx.status === TransactionStatus.COMPLETED) {
      return 'critical';
    }
    
    if (tx.status === TransactionStatus.FAILED) {
      return 'medium';
    }
    
    const hoursSinceCreation = (Date.now() - tx.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceCreation > 24) {
      return 'high';
    }
    
    return 'low';
  }
  
  /**
   * Check if statuses are consistent between internal and external systems
   */
  private isStatusConsistent(
    internalStatus: TransactionStatus,
    externalStatus: string
  ): boolean {
    // Map internal statuses to expected external statuses
    const statusMapping: Record<TransactionStatus, string[]> = {
      [TransactionStatus.PENDING]: ['pending', 'initiated', 'processing'],
      [TransactionStatus.PROCESSING]: ['processing', 'in_progress', 'pending'],
      [TransactionStatus.COMPLETED]: ['completed', 'succeeded', 'settled'],
      [TransactionStatus.FAILED]: ['failed', 'declined', 'error'],
      [TransactionStatus.ROLLED_BACK]: ['voided', 'reversed', 'cancelled', 'refunded'],
      [TransactionStatus.RECOVERY_PENDING]: ['pending', 'processing'],
      [TransactionStatus.RECOVERY_IN_PROGRESS]: ['processing', 'in_progress']
    };
    
    // Check if external status is in expected list for internal status
    return statusMapping[internalStatus]?.includes(externalStatus.toLowerCase()) || false;
  }
  
  /**
   * Determine severity of status mismatches
   */
  private getStatusMismatchSeverity(
    internalStatus: TransactionStatus,
    externalStatus: string
  ): 'low' | 'medium' | 'high' | 'critical' {
    // Terminal states with mismatches are serious
    if (
      (internalStatus === TransactionStatus.COMPLETED && 
       !['completed', 'succeeded', 'settled'].includes(externalStatus.toLowerCase())) ||
      (internalStatus === TransactionStatus.FAILED && 
       ['completed', 'succeeded', 'settled'].includes(externalStatus.toLowerCase()))
    ) {
      return 'critical';
    }
    
    // Completed external but not internal is serious
    if (
      ['completed', 'succeeded', 'settled'].includes(externalStatus.toLowerCase()) &&
      ![TransactionStatus.COMPLETED].includes(internalStatus)
    ) {
      return 'high';
    }
    
    // Failed external but not internal
    if (
      ['failed', 'declined', 'error'].includes(externalStatus.toLowerCase()) &&
      ![TransactionStatus.FAILED].includes(internalStatus)
    ) {
      return 'medium';
    }
    
    // Other mismatches
    return 'low';
  }
  
  /**
   * Create summary statistics for the reconciliation
   */
  private summarizeReconciliation(
    internalTransactions: Transaction[],
    externalTransactions: ExternalTransaction[],
    mismatches: ReconciliationMismatch[]
  ): ReconciliationResult['summary'] {
    // Count transactions by status
    const succeeded = internalTransactions.filter(
      tx => tx.status === TransactionStatus.COMPLETED
    ).length;
    
    const failed = internalTransactions.filter(
      tx => tx.status === TransactionStatus.FAILED
    ).length;
    
    const inProgress = internalTransactions.filter(
      tx => ![
        TransactionStatus.COMPLETED,
        TransactionStatus.FAILED,
        TransactionStatus.ROLLED_BACK
      ].includes(tx.status)
    ).length;
    
    // Count inconsistencies by type
    const statusMismatches = mismatches.filter(
      m => m.type === 'status_mismatch'
    ).length;
    
    const amountMismatches = mismatches.filter(
      m => m.type === 'amount_mismatch'
    ).length;
    
    const orphaned = mismatches.filter(
      m => m.type === 'orphaned'
    ).length;
    
    const missing = mismatches.filter(
      m => m.type === 'missing'
    ).length;
    
    const inconsistent = statusMismatches + amountMismatches;
    
    return {
      succeeded,
      failed,
      inProgress,
      inconsistent,
      orphaned,
      missing
    };
  }
}

/**
 * Interface for external transaction data
 */
export interface ExternalTransaction {
  externalId: string;
  internalId?: string;
  status: string;
  amount: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Interface for adapters to external payment systems
 */
export interface ExternalSystemAdapter {
  getTransactions(
    references: Array<{
      internalId: string;
      externalId: string;
      amount: number;
      currency: string;
    }>,
    systemId?: string
  ): Promise<ExternalTransaction[]>;
}
