import { 
  PaymentProviderInterface,
  ProviderConfig,
  CreatePaymentInput,
  PaymentResult,
  PaymentMethod,
  AddPaymentMethodInput
} from '../types/provider.types';

export abstract class BasePaymentProvider implements PaymentProviderInterface {
  protected config: ProviderConfig;
  protected initialized: boolean = false;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.initialized = true;
  }

  protected checkInitialization(): void {
    if (!this.initialized) {
      throw new Error('Payment provider not initialized');
    }
  }

  abstract createPayment(data: CreatePaymentInput): Promise<PaymentResult>;
  abstract confirmPayment(paymentId: string): Promise<PaymentResult>;
  abstract getPaymentMethods(customerId: string): Promise<PaymentMethod[]>;
  abstract addPaymentMethod(customerId: string, data: AddPaymentMethodInput): Promise<PaymentMethod>;
  abstract removePaymentMethod(methodId: string): Promise<void>;
}