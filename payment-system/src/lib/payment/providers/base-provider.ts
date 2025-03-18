// src/lib/payment/providers/base-provider.ts
import { 
  PaymentProviderInterface,
  ProviderConfig,
  CreatePaymentInput,
  PaymentResult,
  PaymentMethod,
  AddPaymentMethodInput
} from '../types/provider.types';
import { errorHandler, ErrorCode } from '../utils/error';

export abstract class BasePaymentProvider implements PaymentProviderInterface {
  protected config: ProviderConfig;
  protected initialized: boolean = false;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.initialized = true;
  }

  protected checkInitialization(): void {
    if (!this.initialized) {
      throw errorHandler.createError(
        'Payment provider not initialized',
        ErrorCode.PROVIDER_NOT_INITIALIZED,
        { provider: this.constructor.name }
      );
    }
  }

  // Added implementation for verifyWebhookSignature with default behavior
  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    this.checkInitialization();
    // Default implementation returns false - concrete providers should override this
    console.warn('verifyWebhookSignature not implemented by provider');
    return false;
  }

  abstract createPayment(data: CreatePaymentInput): Promise<PaymentResult>;
  abstract confirmPayment(paymentId: string): Promise<PaymentResult>;
  abstract getPaymentMethods(customerId: string): Promise<PaymentMethod[]>;
  abstract addPaymentMethod(customerId: string, data: AddPaymentMethodInput): Promise<PaymentMethod>;
  abstract removePaymentMethod(methodId: string): Promise<void>;
}
