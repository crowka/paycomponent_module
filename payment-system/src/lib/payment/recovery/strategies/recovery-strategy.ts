// src/lib/payment/recovery/strategies/recovery-strategy.ts
import { Transaction, TransactionError } from '../../types/transaction.types';

export interface RecoveryStrategyResult {
  success: boolean;
  data?: any;
  error?: TransactionError;
}

/**
 * Interface for implementing recovery strategies
 */
export interface RecoveryStrategy {
  /**
   * Type of recovery strategy for logging and identification
   */
  type: string;
  
  /**
   * Flag to indicate if this is a general fallback strategy
   */
  isGeneral?: boolean;
  
  /**
   * Determine if this strategy can handle the given error
   * @param error The error to handle
   * @returns True if this strategy can handle the error
   */
  canHandle?(error: TransactionError): boolean;
  
  /**
   * Execute the recovery strategy
   * @param transaction The transaction to recover
   * @returns Result of the recovery attempt
   */
  execute(transaction: Transaction): Promise<RecoveryStrategyResult>;
}
