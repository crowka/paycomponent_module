import { 
  PaymentProviderInterface,
  CreatePaymentInput,
  PaymentResult,
  PaymentMethod,
  AddPaymentMethodInput
} from '../types/provider.types';
import { ITransactionRepository } from '../repositories/transaction.repository';
import { PaymentValidator } from '../validators/payment.validator';
import { PaymentLogger } from '../utils/logger';
import { encrypt } from '../utils/encryption';
import { Transaction, TransactionStatus } from '../types';

interface PaymentServiceOptions {
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export class PaymentService {
  private logger: PaymentLogger;

  constructor(
    private provider: PaymentProviderInterface,
    private transactionRepository: ITransactionRepository,
    private validator: PaymentValidator,
    private options: PaymentServiceOptions = {}
  ) {
    this.logger = new PaymentLogger(options.logLevel || 'info');
  }

  async processPayment(input: CreatePaymentInput): Promise<PaymentResult> {
    // Create initial transaction record
    const transaction = await this.createTransaction(input);
    
    try {
      // Validate input
      await this.validator.validate(input);

      // Encrypt sensitive data
      const encryptedData = await this.encryptSensitiveData(input);

      // Process payment with provider
      this.logger.info('Processing payment', { amount: input.amount });
      const result = await this.provider.createPayment(encryptedData);

      // Update transaction status
      await this.updateTransactionStatus(
        transaction.id, 
        result.success ? TransactionStatus.COMPLETED : TransactionStatus.FAILED,
        result
      );

      // Log result
      if (result.success) {
        this.logger.info('Payment successful', { transactionId: result.transactionId });
      } else {
        this.logger.error('Payment failed', { error: result.error });
      }

      return result;
    } catch (error) {
      // Handle error and update transaction
      await this.handlePaymentError(transaction.id, error);
      this.logger.error('Payment processing error', { error });
      throw error;
    }
  }

  async getPaymentMethods(customerId: string): Promise<PaymentMethod[]> {
    try {
      const methods = await this.provider.getPaymentMethods(customerId);
      return methods.map(method => ({
        ...method,
        details: this.maskSensitiveData(method.details)
      }));
    } catch (error) {
      this.logger.error('Error fetching payment methods', { error });
      throw error;
    }
  }

  async addPaymentMethod(
    customerId: string,
    input: AddPaymentMethodInput
  ): Promise<PaymentMethod> {
    try {
      const encryptedDetails = await encrypt(input.details);
      const method = await this.provider.addPaymentMethod(customerId, {
        ...input,
        details: encryptedDetails
      });

      return {
        ...method,
        details: this.maskSensitiveData(method.details)
      };
    } catch (error) {
      this.logger.error('Error adding payment method', { error });
      throw error;
    }
  }

  async removePaymentMethod(methodId: string): Promise<void> {
    try {
      await this.provider.removePaymentMethod(methodId);
      this.logger.info('Payment method removed', { methodId });
    } catch (error) {
      this.logger.error('Error removing payment method', { error });
      throw error;
    }
  }

  private async createTransaction(input: CreatePaymentInput): Promise<Transaction> {
    const transaction: Transaction = {
      id: crypto.randomUUID(),
      status: TransactionStatus.PENDING,
      amount: input.amount.amount,
      currency: input.amount.currency,
      customerId: input.customer.id,
      metadata: input.metadata,
      createdAt: new Date(),
