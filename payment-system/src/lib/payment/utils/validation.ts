// src/lib/payment/utils/validation.ts
import { CreatePaymentInput, PaymentAmount } from '../types/provider.types';

export function validatePaymentInput(input: CreatePaymentInput): void {
  validateAmount(input.amount);
  validateCustomer(input.customer);
  validatePaymentMethod(input.paymentMethod);
}

function validateAmount(amount: PaymentAmount): void {
  if (!amount || typeof amount.amount !== 'number' || amount.amount <= 0) {
    throw new Error('Invalid payment amount');
  }
  
  if (!amount.currency || typeof amount.currency !== 'string') {
    throw new Error('Invalid currency');
  }
}

function validateCustomer(customer: any): void {
  if (!customer || !customer.id || !customer.email) {
    throw new Error('Invalid customer information');
  }
}

function validatePaymentMethod(method: any): void {
  if (!method || (typeof method !== 'string' && typeof method !== 'object')) {
    throw new Error('Invalid payment method');
  }
}