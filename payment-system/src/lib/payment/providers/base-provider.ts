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
import { validatePaymentInput, validateAddPaymentMethodInput } from '../utils/validation';
import { PaymentLogger } from '../utils/logger';

export abstract class BasePaymentProvider implements PaymentProviderInterface {
  protected config: ProviderConfig;
  protected initialized: boolean = false;
  protected logger: PaymentLogger;

  constructor() {
    this.logger = new PaymentLogger('info', this.constructor.name);
  }

  async initialize(config: ProviderConfig): Promise<void> {
    // Validate configuration
    this.validateConfig(config);
    
    this.config = config;
    this.initialized = true;
  }

  protected validateConfig(config: ProviderConfig): void {
    if (!config) {
      throw errorHandler.createError(
        'Provider configuration is required',
        ErrorCode.CONFIGURATION_ERROR
      );
    }

    if (!config.apiKey) {
      throw errorHandler.createError(
        'API key is required in provider configuration',
        ErrorCode.CONFIGURATION_ERROR
      );
    }

    if (!config.environment || !['sandbox', 'production'].includes(config.environment)) {
      throw errorHandler.createError(
        'Valid environment (sandbox or production) is required',
        ErrorCode.CONFIGURATION_ERROR,
        { providedEnvironment: config.environment }
      );
    }
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

  protected validateCreatePaymentInput(data: CreatePaymentInput): void {
    validatePaymentInput(data);
  }

  protected validateAddPaymentMethodInput(data: AddPaymentMethodInput): void {
    validateAddPaymentMethodInput(data);
  }

  // Added implementation for verifyWebhookSignature with default behavior
  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    this.checkInitialization();
    
    // Validate parameters
    if (!payload) {
      throw errorHandler.createError(
        'Webhook payload is required',
        ErrorCode.VALIDATION_ERROR
      );
    }
    
    if (!signature) {
      throw errorHandler.createError(
        'Webhook signature is required',
        ErrorCode.VALIDATION_ERROR
      );
    }
    
    // Default implementation returns false - concrete providers should override this
    this.logger.warn('verifyWebhookSignature not implemented by provider');
    return false;
  }

  abstract createPayment(data: CreatePaymentInput): Promise<PaymentResult>;
  abstract confirmPayment(paymentId: string): Promise<PaymentResult>;
  abstract getPaymentMethods(customerId: string): Promise<PaymentMethod[]>;
  abstract addPaymentMethod(customerId: string, data: AddPaymentMethodInput): Promise<PaymentMethod>;
  abstract removePaymentMethod(methodId: string): Promise<void>;
}
