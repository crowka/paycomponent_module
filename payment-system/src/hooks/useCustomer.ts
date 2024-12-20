// src/hooks/useCustomer.ts
import { useState, useCallback } from 'react';
import { CustomerProfile } from '../lib/payment/types';

interface UseCustomerReturn {
  isLoading: boolean;
  error: string | null;
  customer: CustomerProfile | null;
  fetchCustomer: () => Promise<void>;
  updateCustomer: (data: Partial<CustomerProfile>) => Promise<CustomerProfile>;
  updatePaymentPreferences: (preferences: any) => Promise<void>;
}

export const useCustomer = (): UseCustomerReturn => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);

  const fetchCustomer = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/customers/me');
      if (!response.ok) {
        throw new Error('Failed to fetch customer profile');
      }
      const data = await response.json();
      setCustomer(data);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateCustomer = useCallback(async (data: Partial<CustomerProfile>): Promise<CustomerProfile> => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/customers/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error('Failed to update customer profile');
      }

      const updatedCustomer = await response.json();
      setCustomer(updatedCustomer);
      return updatedCustomer;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updatePaymentPreferences = useCallback(async (preferences: any): Promise<void> => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/customers/me/payment-preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(preferences),
      });

      if (!response.ok) {
        throw new Error('Failed to update payment preferences');
      }

      await fetchCustomer();
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [fetchCustomer]);

  return {
    isLoading,
    error,
    customer,
    fetchCustomer,
    updateCustomer,
    updatePaymentPreferences,
  };
};