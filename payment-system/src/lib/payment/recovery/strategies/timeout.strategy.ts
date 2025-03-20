// src/lib/payment/recovery/strategies/timeout.strategy.ts
import { 
  RecoveryStrategy,
  RecoveryStrategyResult 
} from './recovery-strategy';
import { 
  Transaction, 
  TransactionError, 
  TransactionErrorCode
} from '../../types/transaction.types';
import { PaymentLogger } from '../../utils/logger';
import { PaymentProviderFactory } from '../../providers/provider-factory';
import { PaymentProviderInterface } from '../../types/provider.types';

export class TimeoutRecoveryStrategy implements RecoveryStrategy {
  type = 'timeout';
  private logger: PaymentLogger;
  private provider?: PaymentProviderInterface;
  private maxWaitTime: number;

  constructor(
    private providerName: string,
    private providerConfig: any,
    options: {
      maxWaitTime?: number;
    } = {}
  ) {
    this.logger = new PaymentLogger('info', 'TimeoutRecoveryStrategy');
    this.maxWaitTime = options.maxWaitTime || 60000; // Default: 1 minute max wait
  }

  canHandle(error: TransactionError): boolean {
    // Handle timeout-related errors
    return error.code === TransactionErrorCode.TIMEOUT ||
           error.code === 'REQUEST_TIMEOUT' ||
           error.code === 'CONNECTION_TIMEOUT' ||
           (error.code === 'PROVIDER_ERROR' && error.details?.isTimeout);
  }

  async execute(transaction: Transaction): Promise<RecoveryStrategyResult> {
    try {
      this.logger.info(`Executing timeout recovery strategy for transaction ${transaction.id}`);

      // Initialize provider if not already done
      if (!this.provider) {
        this.provider = await PaymentProviderFactory.createProvider(
          this.providerName,
          this.providerConfig
        );
      }

      // Calculate how long to wait for this recovery attempt
      const createdTime = transaction.createdAt.getTime();
      const now = Date.now();
      const elapsedTime = now - createdTime;
      
      // If the transaction is too old, don't wait for it
      if (elapsedTime > this.maxWaitTime) {
        this.logger.info(`Transaction ${transaction.id} is too old, skipping wait and checking status directly`);
      } else {
        // For newer transactions, add a short wait period to allow the provider to process it
        const waitTime = Math.min(3000, this.maxWaitTime - elapsedTime);
        this.logger.info(`Waiting ${waitTime}ms for transaction ${transaction.id} to complete`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      // Check transaction status with the payment provider
      this.logger.info(`Verifying transaction status with provider for ${transaction.id}`);
      
      // Get external transaction ID from metadata if available
      const externalId = transaction.metadata?.externalId || transaction.id;
      
      // Query provider for transaction status
      const transactionStatus = await this.provider.getTransactionStatus(externalId);
      
      if (!transactionStatus) {
        this.logger.warn(`No status found for transaction ${transaction.id} with provider`);
        
        // If the transaction is relatively new, it might still be processing
        if (elapsedTime < this.maxWaitTime / 2) {
          return {
            success: false,
            error: {
              code: 'TRANSACTION_STILL_PROCESSING',
              message: 'Transaction may still be processing with payment provider',
              recoverable: true,
              retryable: true,
              details: { 
                externalId,
                elapsedTime,
                maxWaitTime: this.maxWaitTime
              }
            }
          };
        }
        
        // Otherwise, consider it a failure
        return {
          success: false,
          error: {
            code: 'TRANSACTION_NOT_FOUND_WITH_PROVIDER',
            message: 'Transaction not found with payment provider after timeout',
            recoverable: false,
            retryable: false,
            details: { externalId }
          }
        };
      }

      // Handle transaction status
      if (transactionStatus.status === 'succeeded' || 
          transactionStatus.status === 'settled' ||
          transactionStatus.status === 'completed') {
        
        this.logger.info(`Transaction ${transaction.id} completed successfully with provider`);
        
        // Return success with provider data
        return {
          success: true,
          data: {
            providerStatus: transactionStatus.status,
            providerReference: transactionStatus.reference,
            recoveredAt: new Date()
          }
        };
      } else if (
        transactionStatus.status === 'pending' || 
        transactionStatus.status === 'processing' ||
        transactionStatus.status === 'in_progress'
      ) {
        // Transaction is still in progress with the provider
        this.logger.info(`Transaction ${transaction.id} is still in progress with provider`);
        
        // If elapsed time is within acceptable range, allow retry
        if (elapsedTime < this.maxWaitTime) {
          return {
            success: false,
            error: {
              code: 'TRANSACTION_STILL_PROCESSING',
              message: 'Transaction is still being processed by the provider',
              recoverable: true,
              retryable: true,
              details: { 
                providerStatus: transactionStatus.status,
                elapsedTime,
                maxWaitTime: this.maxWaitTime
              }
            }
          };
        } else {
          // Transaction has been processing for too long, mark as abandoned
          return {
            success: false,
            error: {
              code: 'TRANSACTION_TIMED_OUT',
              message: `Transaction processing exceeded maximum wait time of ${this.maxWaitTime}ms`,
              recoverable: false,
              retryable: false,
              details: { 
                providerStatus: transactionStatus.status,
                elapsedTime,
                maxWaitTime: this.maxWaitTime
              }
            }
          };
        }
      } else {
        // Transaction failed with the provider
        this.logger.info(`Transaction ${transaction.id} failed with provider: ${transactionStatus.status}`);
        
        return {
          success: false,
          error: {
            code: 'TRANSACTION_FAILED_WITH_PROVIDER',
            message: `Transaction failed with provider: ${transactionStatus.status}`,
            recoverable: false,
            retryable: false,
            details: { 
              providerStatus: transactionStatus.status,
              providerReference: transactionStatus.reference,
              errorMessage: transactionStatus.error?.message
            }
          }
        };
      }
    } catch (error) {
      this.logger.error(`Error executing timeout recovery strategy for transaction ${transaction.id}`, { error });
      
      return {
        success: false,
        error: {
          code: 'RECOVERY_EXECUTION_ERROR',
          message: error.message || 'Error executing timeout recovery strategy',
          recoverable: false,
          retryable: true,
          details: { originalError: error }
        }
      };
    }
  }
}
