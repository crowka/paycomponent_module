// src/tests/integration/stripe-provider.integration.test.ts
import { StripeProvider } from '../../lib/payment/providers/stripe-provider';
import { PaymentLogger } from '../../lib/payment/utils/logger';
import dotenv from 'dotenv';

// Configure dotenv
dotenv.config();

// Mock logger to avoid console output during tests
jest.mock('../../lib/payment/utils/logger', () => {
  return {
    PaymentLogger: jest.fn().mockImplementation(() => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    }))
  };
});

describe('Stripe Provider Integration Tests', () => {
  let provider: StripeProvider;
  
  beforeAll(async () => {
    // Create and initialize provider
    provider = new StripeProvider();
    await provider.initialize({
      apiKey: process.env.STRIPE_TEST_KEY || 'sk_test_your_stripe_test_key',
      environment: 'sandbox'
    });
  });
  
  it('should handle a simple payment flow', async () => {
    // Use Stripe test card
    const paymentInput = {
      amount: {
        amount: 10.99,
        currency: 'USD'
      },
      customer: {
        id: 'test-customer-1',
        email: 'test@example.com',
        name: 'Test Customer'
      },
      paymentMethod: {
        type: 'card',
        details: {
          number: '4242424242424242', // Stripe test card
          exp_month: 12,
          exp_year: new Date().getFullYear() + 1,
          cvc: '123'
        }
      },
      metadata: {
        testMode: true
      }
    };
    
    // Process payment
    const result = await provider.createPayment(paymentInput);
    
    // Verify result
    expect(result.success).toBe(true);
    expect(result.transactionId).toBeDefined();
    
    if (result.success && result.transactionId) {
      // Confirm payment
      const confirmResult = await provider.confirmPayment(result.transactionId);
      expect(confirmResult.success).toBe(true);
    }
  });
  
  it('should handle payment method management', async () => {
    const customerId = `test-customer-${Date.now()}`;
    
    // Add payment method
    const methodData = {
      type: 'card',
      details: {
        number: '4242424242424242', // Stripe test card
        exp_month: 12,
        exp_year: new Date().getFullYear() + 1,
        cvc: '123'
      },
      setAsDefault: true
    };
    
    const method = await provider.addPaymentMethod(customerId, methodData);
    
    expect(method.id).toBeDefined();
    expect(method.isDefault).toBe(true);
    expect(method.details.last4).toBe('4242');
    
    // Get payment methods
    const methods = await provider.getPaymentMethods(customerId);
    expect(methods.length).toBeGreaterThan(0);
    
    // Remove payment method
    await provider.removePaymentMethod(method.id);
    
    // Verify removal
    const updatedMethods = await provider.getPaymentMethods(customerId);
    expect(updatedMethods.findIndex(m => m.id === method.id)).toBe(-1);
  });
});
