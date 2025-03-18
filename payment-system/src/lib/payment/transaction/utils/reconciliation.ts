// src/lib/payment/transaction/utils/reconciliation.ts
import { v4 as uuidv4 } from 'uuid';
import { Transaction, TransactionStatus, TransactionType } from '../types';
import { TransactionStore } from '../store/transaction.store';
import { PaymentLogger } from '../../utils/logger';
import { errorHandler, ErrorCode } from '../../utils/error';
import { EventEmitter } from '../../events/event.emitter';
import { AlertDetector } from '../../monitoring/alerts/detector';

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
  retryable: boolean;
  fixStrategy?: string;
}

export interface ReconciliationOptions {
  startDate?: Date;
  endDate?: Date;
  customerId?: string;
  transactionType?: TransactionType;
  batchSize?: number;
  externalSystemId?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  alertOnMismatch?: boolean;
  amountTolerancePercentage?: number; // For handling small differences in amounts
  timezoneToleranceMs?: number; // For handling timezone discrepancies
}

/**
 * TransactionReconciliator verifies consistency between the internal transaction store
 * and external payment systems, identifies discrepancies, and provides data for
 * reconciliation processes.
 */
export class TransactionReconciliator {
  private logger: PaymentLogger;
  private eventEmitter?: EventEmitter;
  private alertDetector?: AlertDetector;
  private defaultBatchSize: number = 100;
  private defaultMaxRetries: number = 3;
  private defaultRetryDelayMs: number = 1000;
  private defaultAmountTolerance: number = 0.01; // 1% tolerance for amount differences
  private defaultTimezoneTolerance: number = 60 * 60 * 1000; // 1 hour tolerance for timestamp differences
  
  constructor(
    private transactionStore: TransactionStore,
    private externalSystemAdapter: ExternalSystemAdapter,
    options: {
      eventEmitter?: EventEmitter;
      alertDetector?: AlertDetector;
      defaultBatchSize?: number;
      defaultMaxRetries?: number;
      defaultRetryDelayMs?: number;
      defaultAmountTolerance?: number;
      defaultTimezoneTolerance?: number;
    } = {}
  ) {
    this.logger = new PaymentLogger('info', 'TransactionReconciliator');
    this.eventEmitter = options.eventEmitter;
    this.alertDetector = options.alertDetector;
    this.defaultBatchSize = options.defaultBatchSize || this.defaultBatchSize;
    this.defaultMaxRetries = options.defaultMaxRetries || this.defaultMaxRetries;
    this.defaultRetryDelayMs = options.defaultRetryDelayMs || this.defaultRetryDelayMs;
    this.defaultAmountTolerance = options.defaultAmountTolerance || this.defaultAmountTolerance;
    this.defaultTimezoneTolerance = options.defaultTimezoneTolerance || this.defaultTimezoneTolerance;
  }
  
  /**
   * Perform reconciliation between internal transactions and external system
   * with automatic retries and detailed error handling
   */
  async reconcile(options: ReconciliationOptions = {}): Promise<ReconciliationResult> {
    const {
      startDate = new Date(Date.now() - 24 * 60 * 60 * 1000), // Default to last 24 hours
      endDate = new Date(),
      batchSize = this.defaultBatchSize,
      maxRetries = this.defaultMaxRetries,
      retryDelayMs = this.defaultRetryDelayMs,
      alertOnMismatch = true,
      amountTolerancePercentage = this.defaultAmountTolerance,
      timezoneToleranceMs = this.defaultTimezoneTolerance
    } = options;
    
    const reconciliationId = uuidv4();

    // Initialize metrics collection for this reconciliation
    const metrics = {
      startTime: Date.now(),
      retryCount: 0,
      batchesProcessed: 0,
      totalTransactions: 0,
      successfulComparisons: 0,
      failedComparisons: 0
    };
    
    this.logger.info(`Starting transaction reconciliation #${reconciliationId}`, {
      startDate,
      endDate,
      customerId: options.customerId,
      transactionType: options.transactionType,
      batchSize
    });
    
    try {
      // Step 1: Fetch internal transactions with pagination to handle large datasets
      let internalTransactions: Transaction[] = [];
      let offset = 0;
      let hasMore = true;
      
      while (hasMore) {
        const batchResult = await this.fetchInternalTransactionBatch(
          options,
          offset,
          batchSize
        );
        
        internalTransactions = [...internalTransactions, ...batchResult.transactions];
        offset += batchSize;
        hasMore = batchResult.hasMore;
        metrics.batchesProcessed++;
        metrics.totalTransactions += batchResult.transactions.length;
        
        // Log progress for large reconciliations
        if (metrics.batchesProcessed % 10 === 0) {
          this.logger.info(`Processed ${metrics.batchesProcessed} batches, ${internalTransactions.length} transactions so far`);
        }
      }
      
      if (internalTransactions.length === 0) {
        this.logger.info(`No transactions found for reconciliation #${reconciliationId}`);
        return this.createEmptyResult(reconciliationId);
      }
      
      // Step 2: Fetch corresponding external transactions with retry logic
      let externalTransactions: ExternalTransaction[] = [];
      let retryCount = 0;
      let success = false;
      
      while (!success && retryCount <= maxRetries) {
        try {
          externalTransactions = await this.fetchExternalTransactions(
            internalTransactions,
            options.externalSystemId,
            amountTolerancePercentage
          );
          success = true;
        } catch (error) {
          retryCount++;
          metrics.retryCount = retryCount;
          
          if (retryCount <= maxRetries) {
            const backoffTime = retryDelayMs * Math.pow(2, retryCount - 1);
            this.logger.warn(`Retrying external transaction fetch (attempt ${retryCount}/${maxRetries})`, {
              error: error.message,
              backoffTime
            });
            
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, backoffTime));
          } else {
            throw error;
          }
        }
      }
      
      // Step 3: Compare and identify discrepancies with enhanced matching logic
      const mismatches = await this.compareTransactions(
        internalTransactions,
        externalTransactions,
        {
          amountTolerancePercentage,
          timezoneToleranceMs
        }
      );
      
      metrics.successfulComparisons = internalTransactions.length - mismatches.length;
      metrics.failedComparisons = mismatches.length;
      
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
      
      const executionTime = Date.now() - metrics.startTime;
      this.logger.info(`Completed reconciliation #${reconciliationId} in ${executionTime}ms`, {
        transactionsChecked: result.transactionsChecked,
        mismatchCount: result.mismatches.length,
        summary,
        metrics
      });
      
      // Generate alerts for critical mismatches if alert detector is available
      if (alertOnMismatch && this.alertDetector && mismatches.length > 0) {
        this.generateAlertsForMismatches(mismatches, reconciliationId);
      }
      
      // Emit reconciliation event
      if (this.eventEmitter) {
        await this.eventEmitter.emit('transaction.reconciliation_completed', {
          reconciliationId,
          timestamp: result.timestamp,
          summary: result.summary,
          metrics
        });
      }
      
      return result;
    } catch (error) {
      const executionTime = Date.now() - metrics.startTime;
      this.logger.error(`Reconciliation #${reconciliationId} failed after ${executionTime}ms`, { 
        error,
        metrics 
      });
      
      // Emit failure event
      if (this.eventEmitter) {
        await this.eventEmitter.emit('transaction.reconciliation_failed', {
          reconciliationId,
          error: error.message,
          metrics
        });
      }
      
      throw errorHandler.wrapError(
        error,
        'Transaction reconciliation failed',
        ErrorCode.RECONCILIATION_ERROR,
        { reconciliationId, metrics }
      );
    }
  }
  
  /**
   * Fetch internal transactions in batches for better memory management and performance
   */
  private async fetchInternalTransactionBatch(
    options: ReconciliationOptions,
    offset: number,
    limit: number
  ): Promise<{
    transactions: Transaction[];
    hasMore: boolean;
  }> {
    const {
      startDate,
      endDate,
      customerId,
      transactionType
    } = options;
    
    // Create query with pagination
    const query: any = {
      startDate,
      endDate,
      limit,
      offset
    };
    
    if (transactionType) {
      query.type = transactionType;
    }
    
    // Fetch transactions
    try {
      let transactions: Transaction[];
      
      if (customerId) {
        transactions = await this.transactionStore.query(customerId, query);
      } else {
        // For reconciliation without customerId, we need a special query method
        // This would typically be a custom method in the store
        transactions = await this.transactionStore.queryAll?.(query) || [];
        
        // Fallback if queryAll doesn't exist
        if (transactions.length === 0 && !this.transactionStore.queryAll) {
          this.logger.warn('TransactionStore does not implement queryAll method. Reconciliation without customerId may be incomplete.');
        }
      }
      
      // Determine if there might be more records
      const hasMore = transactions.length === limit;
      
      this.logger.debug(`Fetched ${transactions.length} internal transactions at offset ${offset}`, {
        hasMore,
        startDate,
        endDate,
        offset,
        limit
      });
      
      return {
        transactions,
        hasMore
      };
    } catch (error) {
      this.logger.error('Failed to fetch internal transactions for reconciliation', { error });
      throw errorHandler.wrapError(
        error,
        'Failed to fetch internal transactions for reconciliation',
        ErrorCode.DATABASE_ERROR
      );
    }
  }
  
  /**
   * Fetch corresponding external transactions with efficient batching and retry logic
   */
  private async fetchExternalTransactions(
    internalTransactions: Transaction[],
    externalSystemId?: string,
    amountTolerancePercentage?: number
  ): Promise<ExternalTransaction[]> {
    try {
      // Group transactions by batch to avoid overloading external API
      const batchSize = 50; // Smaller batch size for external API calls
      const transactionBatches: Transaction[][] = [];
      
      for (let i = 0; i < internalTransactions.length; i += batchSize) {
        transactionBatches.push(internalTransactions.slice(i, i + batchSize));
      }
      
      const externalTransactions: ExternalTransaction[] = [];
      
      // Process each batch
      for (let i = 0; i < transactionBatches.length; i++) {
        const batch = transactionBatches[i];
        
        // Extract transaction references
        const transactionReferences = batch.map(tx => ({
          internalId: tx.id,
          externalId: tx.metadata?.externalId || tx.id,
          amount: tx.amount,
          currency: tx.currency
        }));
        
        // Fetch from external system
        const batchResults = await this.externalSystemAdapter.getTransactions(
          transactionReferences,
          externalSystemId
        );
        
        externalTransactions.push(...batchResults);
        
        // Log progress for large batches
        if (transactionBatches.length > 5 && i % 5 === 0 && i > 0) {
          this.logger.info(`Fetched ${externalTransactions.length}/${internalTransactions.length} external transactions (${Math.round((i / transactionBatches.length) * 100)}% complete)`);
        }
      }
      
      this.logger.info(`Fetched ${externalTransactions.length} external transactions for reconciliation`);
      return externalTransactions;
    } catch (error) {
      this.logger.error('Failed to fetch external transactions for reconciliation', { 
        error,
        systemId: externalSystemId,
        transactionCount: internalTransactions.length
      });
      
      throw errorHandler.wrapError(
        error,
        'Failed to fetch external transactions for reconciliation',
        ErrorCode.PROVIDER_COMMUNICATION_ERROR,
        { externalSystemId }
      );
    }
  }
  
  /**
   * Compare internal and external transactions to find mismatches
   * with enhanced tolerance for minor discrepancies
   */
  private async compareTransactions(
    internalTransactions: Transaction[],
    externalTransactions: ExternalTransaction[],
    options: {
      amountTolerancePercentage?: number;
      timezoneToleranceMs?: number;
    } = {}
  ): Promise<ReconciliationMismatch[]> {
    const {
      amountTolerancePercentage = this.defaultAmountTolerance,
      timezoneToleranceMs = this.defaultTimezoneTolerance
    } = options;
    
    const mismatches: ReconciliationMismatch[] = [];
    
    // Create map of external transactions for efficient lookup
    const externalMap = new Map<string, ExternalTransaction>();
    const processedExternalIds = new Set<string>();
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
              externalId,
              createdAt: internalTx.createdAt,
              timeSinceCreation: Date.now() - internalTx.createdAt.getTime()
            },
            severity: this.getMissingSeverity(internalTx),
            retryable: true,
            fixStrategy: this.determineMissingFixStrategy(internalTx)
          });
        }
        continue;
      }
      
      // Mark as processed to track orphaned transactions later
      processedExternalIds.add(externalId);
      
      // Check status consistency with timezone tolerance
      if (!this.isStatusConsistent(
        internalTx.status,
        externalTx.status,
        internalTx.updatedAt,
        externalTx.updatedAt,
        timezoneToleranceMs
      )) {
        mismatches.push({
          transactionId: internalTx.id,
          type: 'status_mismatch',
          details: {
            internalStatus: internalTx.status,
            externalStatus: externalTx.status,
            internalUpdatedAt: internalTx.updatedAt,
            externalUpdatedAt: externalTx.updatedAt,
            timeDifference: Math.abs(
              internalTx.updatedAt.getTime() - externalTx.updatedAt.getTime()
            )
          },
          severity: this.getStatusMismatchSeverity(internalTx.status, externalTx.status),
          retryable: this.isStatusMismatchRetryable(internalTx.status, externalTx.status),
          fixStrategy: this.determineStatusMismatchFixStrategy(internalTx.status, externalTx.status)
        });
      }
      
      // Check amount consistency with tolerance for minor discrepancies
      if (!this.isAmountConsistent(internalTx.amount, externalTx.amount, amountTolerancePercentage)) {
        mismatches.push({
          transactionId: internalTx.id,
          type: 'amount_mismatch',
          details: {
            internalAmount: internalTx.amount,
            externalAmount: externalTx.amount,
            difference: internalTx.amount - externalTx.amount,
            percentageDifference: (Math.abs(internalTx.amount - externalTx.amount) / internalTx.amount) * 100,
            currency: internalTx.currency,
            tolerance: amountTolerancePercentage * 100 + '%'
          },
          severity: this.getAmountMismatchSeverity(internalTx.amount, externalTx.amount, amountTolerancePercentage),
          retryable: false,
          fixStrategy: 'manual_review'
        });
      }
    }
    
    // Any remaining external transactions are orphaned (exist in external system but not internally)
    for (const [externalId, externalTx] of externalMap.entries()) {
      if (!processedExternalIds.has(externalId)) {
        mismatches.push({
          transactionId: externalTx.externalId,
          type: 'orphaned',
          details: {
            externalStatus: externalTx.status,
            externalAmount: externalTx.amount,
            externalCurrency: externalTx.currency,
            externalTimestamp: externalTx.updatedAt,
            timeSinceUpdate: Date.now() - externalTx.updatedAt.getTime()
          },
          severity: 'high',
          retryable: false,
          fixStrategy: 'create_internal_record'
        });
      }
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
   * with tolerance for timestamp differences
   */
  private isStatusConsistent(
    internalStatus: TransactionStatus,
    externalStatus: string,
    internalTimestamp: Date,
    externalTimestamp: Date,
    timezoneToleranceMs: number
  ): boolean {
    // Map internal statuses to expected external statuses
    const statusMapping: Record<TransactionStatus, string[]> = {
      [TransactionStatus.PENDING]: ['pending', 'initiated', 'processing'],
      [TransactionStatus.PROCESSING]: ['processing', 'in_progress', 'pending'],
      [TransactionStatus.COMPLETED]: ['completed', 'succeeded', 'settled'],
      [TransactionStatus.FAILED]: ['failed', 'declined', 'error'],
      [TransactionStatus.ROLLED_BACK]: ['voided', 'reversed', 'cancelled', 'refunded'],
      [TransactionStatus.RECOVERY_PENDING]: ['pending', 'processing', 'recovery'],
      [TransactionStatus.RECOVERY_IN_PROGRESS]: ['processing', 'in_progress', 'recovery']
    };
    
    // For terminal states, always check status regardless of timestamp
    if ([
      TransactionStatus.COMPLETED,
      TransactionStatus.FAILED,
      TransactionStatus.ROLLED_BACK
    ].includes(internalStatus)) {
      return statusMapping[internalStatus]?.includes(externalStatus.toLowerCase()) || false;
    }
    
    // For in-progress states, if timestamps are close, allow status mismatch
    // as it may just be processing delay
    const timestampDifference = Math.abs(
      internalTimestamp.getTime() - externalTimestamp.getTime()
    );
    
    if (timestampDifference <= timezoneToleranceMs) {
      // Allow more flexible matching for in-progress states with recent timestamps
      return true;
    }
    
    // Check if external status is in expected list for internal status
    return statusMapping[internalStatus]?.includes(externalStatus.toLowerCase()) || false;
  }
  
  /**
   * Check if amounts are consistent with a tolerance percentage
   * to account for minor discrepancies like rounding errors
   */
  private isAmountConsistent(
    internalAmount: number,
    externalAmount: number,
    tolerancePercentage: number
  ): boolean {
    if (internalAmount === externalAmount) {
      return true;
    }
    
    const difference = Math.abs(internalAmount - externalAmount);
    const percentageDifference = (difference / internalAmount) * 100;
    
    return percentageDifference <= tolerancePercentage * 100;
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
   * Determine severity of amount mismatches based on percentage difference
   */
  private getAmountMismatchSeverity(
    internalAmount: number,
    externalAmount: number,
    tolerancePercentage: number
  ): 'low' | 'medium' | 'high' | 'critical' {
    const difference = Math.abs(internalAmount - externalAmount);
    const percentageDifference = (difference / internalAmount) * 100;
    
    // Any difference above tolerance is an issue
    if (percentageDifference <= tolerancePercentage * 100) {
      return 'low'; // Within tolerance, shouldn't happen as these are filtered out earlier
    }
    
    if (percentageDifference > 20) {
      return 'critical';
    }
    
    if (percentageDifference > 10) {
      return 'high';
    }
    
    if (percentageDifference > 1) {
      return 'medium';
    }
    
    return 'low';
  }
  
  /**
   * Determine if a status mismatch is retryable
   */
  private isStatusMismatchRetryable(
    internalStatus: TransactionStatus,
    externalStatus: string
  ): boolean {
    // In-progress statuses can be retried
    if ([
      TransactionStatus.PENDING,
      TransactionStatus.PROCESSING,
      TransactionStatus.RECOVERY_PENDING,
      TransactionStatus.RECOVERY_IN_PROGRESS
    ].includes(internalStatus)) {
      return true;
    }
    
    // External in-progress can be retried
    if (['pending', 'processing', 'in_progress'].includes(externalStatus.toLowerCase())) {
      return true;
    }
    
    // Terminal state mismatches typically need manual intervention
    return false;
  }
  
  /**
   * Determine appropriate fix strategy for missing transactions
   */
  private determineMissingFixStrategy(tx: Transaction): string {
    if ([TransactionStatus.COMPLETED, TransactionStatus.FAILED].includes(tx.status)) {
      return 'sync_to_external';
    }
    
    const hoursSinceCreation = (Date.now() - tx.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceCreation > 24) {
      return 'mark_as_failed';
    }
    
    return 'retry_transaction';
  }
  
  /**
   * Determine appropriate fix strategy for status mismatches
   */
  private determineStatusMismatchFixStrategy(
    internalStatus: TransactionStatus,
    externalStatus: string
  ): string {
    // Terminal state conflicts need manual review
    if (
      (internalStatus === TransactionStatus.COMPLETED && 
       ['failed', 'declined', 'error'].includes(externalStatus.toLowerCase())) ||
      (internalStatus === TransactionStatus.FAILED && 
       ['completed', 'succeeded', 'settled'].includes(externalStatus.toLowerCase()))
    ) {
      return 'manual_review';
    }
    
    // External completed but internal not
    if (
      ['completed', 'succeeded', 'settled'].includes(externalStatus.toLowerCase()) &&
      internalStatus !== TransactionStatus.COMPLETED
    ) {
      return 'sync_from_external';
    }
    
    // External failed but internal not
    if (
      ['failed', 'declined', 'error'].includes(externalStatus.toLowerCase()) &&
      internalStatus !== TransactionStatus.FAILED
    ) {
      return 'sync_from_external';
    }
    
    // In-progress status mismatches can be retried
    return 'retry_status_check';
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
  
  /**
   * Generate alerts for critical mismatches
   */
  private generateAlertsForMismatches(
    mismatches: ReconciliationMismatch[],
    reconciliationId: string
  ): void {
    if (!this.alertDetector) {
      return;
    }
    
    // Group mismatches by severity
    const criticalMismatches = mismatches.filter(m => m.severity === 'critical');
    const highMismatches = mismatches.filter(m => m.severity === 'high');
    
 
