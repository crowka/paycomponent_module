export enum PaymentMethodType {
  CREDIT_CARD = 'credit_card',
  DEBIT_CARD = 'debit_card',
  BANK_ACCOUNT = 'bank_account',
  DIGITAL_WALLET = 'digital_wallet',
  CRYPTO = 'crypto'
}

export interface PaymentMethod {
  id: string;
  customerId: string;
  type: PaymentMethodType;
  provider: string;
  isDefault: boolean;
  isExpired: boolean;
  metadata: Record<string, any>;
  details: PaymentMethodDetails;
  expiryDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentMethodDetails {
  last4?: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  bankName?: string;
  accountType?: string;
  walletType?: string;
  cryptoCurrency?: string;
}