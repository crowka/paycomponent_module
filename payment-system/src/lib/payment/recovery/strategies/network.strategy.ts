// src/lib/payment/recovery/strategies/network.strategy.ts
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

export class NetworkRecoveryStrategy implements RecoveryStrategy {
  type = 'network';
  private logger: PaymentLogger;
  private provider?: PaymentProviderInterface;

  constructor(
    private providerName: string,
    private providerConfig: any
  ) {
    this.logger = new PaymentLogger('info', 'NetworkRecoveryStrategy');
  }

  canHandle(error: TransactionError): boolean {
    // Handle network-related errors
    return error.code === TransactionErrorCode.NETWORK_ERROR ||
           error.code === 'CONNECTION_ERROR' ||
           error.code === 'API_ERROR' ||
           (error.code === 'PROVIDER_ERROR' && error.details?.isNetwork);
  }

  async execute(transaction: Transaction): Promise<RecoveryStrategyResult> {
    try {
      this.logger.info(`Executing network recovery strategy for transaction ${transaction.id}`);

      // Initialize provider if not already done
      if (!this.provider) {
        this.provider = await PaymentProviderFactory.createProvider(
          this.providerName,
          this.providerConfig
        );
      }

      // Check transaction status with the payment provider
      this.logger.info(`Verifying transaction status with provider for ${transaction.id}`);
      
      // Get external transaction ID from metadata if available
      const externalId = transaction.metadata?.externalId || transaction.id;
      
      // Query provider for transaction status
      const transactionStatus = await this.provider.getTransactionStatus(externalId);
      
      if (!transactionStatus) {
        this.logger.warn(`No status found for transaction ${transaction.id} with provider`);
        return {
          success: false,
          error: {
            code: 'TRANSACTION_NOT_FOUND_WITH_PROVIDER',
            message: 'Transaction not found with payment provider',
            recoverable: false,
            retryable: false,
            details: { externalId }
          }
        };
      }

      // Determine if transaction was successful with the provider
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
        
        return {
          success: false,
          error: {
            code: 'TRANSACTION_IN_PROGRESS',
            message: 'Transaction is still being processed by the provider',
            recoverable: true,
            retryable: true,
            details: { 
              providerStatus: transactionStatus.status,
              providerReference: transactionStatus.reference
            }
          }
        };
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
      this.logger.error(`Error executing network recovery strategy for transaction ${transaction.id}`, { error });
      
      return {
        success: false,
        error: {
          code: 'RECOVERY_EXECUTION_ERROR',
          message: error.message || 'Error executing network recovery strategy',
          recoverable: false,
          retryable: true,
          details: { originalError: error }
        }
      };
    }
  }
}
