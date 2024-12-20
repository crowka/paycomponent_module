// src/hooks/usePayment.ts
import { useState, useCallback } from 'react';
import { PaymentMethod, PaymentResult } from '../lib/payment/types';

interface UsePaymentReturn {
  isLoading: boolean;
  error: string | null;
  processPayment: (data: any) => Promise<PaymentResult>;
  getPaymentMethods: () => Promise<PaymentMethod[]>;
  addPaymentMethod: (data: any) => Promise<PaymentMethod>;
  removePaymentMethod: (id: string) => Promise<void>;
}

export const usePayment = (): UsePaymentReturn => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processPayment = useCallback(async (data: any): Promise<PaymentResult> => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/payments/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error('Payment processing failed');
      }

      return await response.json();
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getPaymentMethods = useCallback(async (): Promise<PaymentMethod[]> => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/payments/methods');
      if (!response.ok) {
        throw new Error('Failed to fetch payment methods');
      }
      return await response.json();
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const addPaymentMethod = useCallback(async (data: any): Promise<PaymentMethod> => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/payments/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error('Failed to add payment method');
      }

      return await response.json();
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const removePaymentMethod = useCallback(async (id: string): Promise<void> => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/payments/methods/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to remove payment method');
      }
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    isLoading,
    error,
    processPayment,
    getPaymentMethods,
    addPaymentMethod,
    removePaymentMethod,
  };
};