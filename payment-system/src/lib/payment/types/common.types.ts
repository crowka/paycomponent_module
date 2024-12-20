export interface PaymentAmount {
  amount: number;
  currency: string;
}

export interface Customer {
  id: string;
  email: string;
  name?: string;
  metadata?: Record<string, any>;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'bank_account' | 'digital_wallet';
  details: Record<string, any>;
  isDefault: boolean;
  customerId: string;
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  error?: PaymentError;
  metadata?: Record<string, any>;
}

export interface PaymentError {
  code: string;
  message: string;
  details?: Record<string, any>;
}