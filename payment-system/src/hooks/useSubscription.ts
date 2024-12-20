// src/hooks/useSubscription.ts
import { useState, useCallback } from 'react';
import { Subscription } from '../lib/payment/types';

interface UseSubscriptionReturn {
  isLoading: boolean;
  error: string | null;
  subscription: Subscription | null;
  fetchSubscription: () => Promise<void>;
  updateSubscription: (data: any) => Promise<Subscription>;
  cancelSubscription: () => Promise<void>;
}

export const useSubscription = (): UseSubscriptionReturn => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);

  const fetchSubscription = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/subscriptions/current');
      if (!response.ok) {
        throw new Error('Failed to fetch subscription');
      }
      const data = await response.json();
      setSubscription(data);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateSubscription = useCallback(async (data: any): Promise<Subscription> => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/subscriptions/current', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error('Failed to update subscription');
      }

      const updatedSubscription = await response.json();
      setSubscription(updatedSubscription);
      return updatedSubscription;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const cancelSubscription = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/subscriptions/current', {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to cancel subscription');
      }

      setSubscription(null);
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
    subscription,
    fetchSubscription,
    updateSubscription,
    cancelSubscription,
  };
};