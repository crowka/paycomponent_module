// src/hooks/usePayment.ts
// src/hooks/usePayment.ts
import { useState, useCallback } from 'react';
import { PaymentMethod, PaymentResult } from '../lib/payment/types/common.types';

interface UsePaymentReturn {
  isLoading: boolean;
  error: string | null;
  paymentMethods: PaymentMethod[];
  paymentHistory: any[];
  activeSubscription: any | null;
  processPayment: (data: any) => Promise<PaymentResult>;
  fetchPaymentMethods: () => Promise<void>;
  fetchPaymentHistory: () => Promise<void>;
  fetchSubscription: () => Promise<void>;
  cancelSubscription: () => Promise<void>;
  addPaymentMethod: (data: any) => Promise<PaymentMethod>;
  removePaymentMethod: (id: string) => Promise<void>;
}

export const usePayment = (): UsePaymentReturn => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<any[]>([]);
  const [activeSubscription, setActiveSubscription] = useState<any | null>(null);

  const handleRequest = async <T,>(
    requestFn: () => Promise<Response>,
    onSuccess: (data: T) => void
  ): Promise<T> => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await requestFn();
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Request failed');
      }
      const data = await response.json();
      onSuccess(data);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const processPayment = useCallback(async (data: any): Promise<PaymentResult> => {
    return handleRequest<PaymentResult>(
      () => fetch('/api/payments/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
      () => {}
    );
  }, []);

  const fetchPaymentMethods = useCallback(async (): Promise<void> => {
    handleRequest<PaymentMethod[]>(
      () => fetch('/api/payments/methods'),
      (data) => setPaymentMethods(data)
    );
  }, []);

  const fetchPaymentHistory = useCallback(async (): Promise<void> => {
    handleRequest<any[]>(
      () => fetch('/api/transactions'),
      (data) => setPaymentHistory(data)
    );
  }, []);

  const fetchSubscription = useCallback(async (): Promise<void> => {
    handleRequest<any>(
      () => fetch('/api/subscriptions/current'),
      (data) => setActiveSubscription(data)
    );
  }, []);

  const cancelSubscription = useCallback(async (): Promise<void> => {
    handleRequest<void>(
      () => fetch('/api/subscriptions/current', {
        method: 'DELETE',
      }),
      () => setActiveSubscription(null)
    );
  }, []);

  const addPaymentMethod = useCallback(async (data: any): Promise<PaymentMethod> => {
    return handleRequest<PaymentMethod>(
      () => fetch('/api/payments/methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
      (method) => setPaymentMethods(prev => [...prev, method])
    );
  }, []);

  const removePaymentMethod = useCallback(async (id: string): Promise<void> => {
    handleRequest<void>(
      () => fetch(`/api/payments/methods/${id}`, {
        method: 'DELETE',
      }),
      () => setPaymentMethods(prev => prev.filter(method => method.id !== id))
    );
  }, []);

  return {
    isLoading,
    error,
    paymentMethods,
    paymentHistory,
    activeSubscription,
    processPayment,
    fetchPaymentMethods,
    fetchPaymentHistory,
    fetchSubscription,
    cancelSubscription,
    addPaymentMethod,
    removePaymentMethod,
  };
};
