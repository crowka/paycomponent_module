// src/lib/payment/types/provider.types.ts
import { PaymentAmount, Customer, PaymentMethod, PaymentResult } from './common.types';

export interface ProviderConfig {
  apiKey: string;
  environment: 'sandbox' | 'production';
  webhookSecret?: string;
  options?: Record<string, any>;
}

export interface PaymentProviderInterface {
  initialize(config: ProviderConfig): Promise<void>;
  createPayment(data: CreatePaymentInput): Promise<PaymentResult>;
  confirmPayment(paymentId: string): Promise<PaymentResult>;
  getPaymentMethods(customerId: string): Promise<PaymentMethod[]>;
  addPaymentMethod(customerId: string, data: AddPaymentMethodInput): Promise<PaymentMethod>;
  removePaymentMethod(methodId: string): Promise<void>;
  verifyWebhookSignature?(payload: string, signature: string): Promise<boolean>;
}

export interface CreatePaymentInput {
  amount: PaymentAmount;
  customer: Customer;
  paymentMethod: string | PaymentMethod;
  metadata?: Record<string, any>;
}

export interface AddPaymentMethodInput {
  type: 'card' | 'bank_account' | 'digital_wallet';
  details: Record<string, any>;
  setAsDefault?: boolean;
}
