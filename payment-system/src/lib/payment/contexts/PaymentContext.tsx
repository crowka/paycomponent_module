// src/lib/payment/contexts/PaymentContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { 
  CreatePaymentInput, 
  PaymentResult, 
  PaymentMethod,
  AddPaymentMethodInput,
  ProviderConfig 
} from '../types/provider.types';

interface PaymentContextType {
  processPayment: (input: CreatePaymentInput) => Promise<PaymentResult>;
  getPaymentMethods: (customerId: string) => Promise<PaymentMethod[]>;
  addPaymentMethod: (customerId: string, input: AddPaymentMethodInput) => Promise<PaymentMethod>;
  removePaymentMethod: (methodId: string) => Promise<void>;
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
}

interface PaymentProviderProps {
  providerName: string;
  config: ProviderConfig;
  children: React.ReactNode;
}

const PaymentContext = createContext<PaymentContextType | null>(null);

export function PaymentProvider({ providerName, config, children }: PaymentProviderProps) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [api, setApi] = useState<any>(null);

  useEffect(() => {
    const initializeProvider = async () => {
      try {
        setIsLoading(true);
        
        // Simple fetch-based API for frontend
        const apiClient = {
          async processPayment(input: CreatePaymentInput): Promise<PaymentResult> {
            const response = await fetch('/api/payments/process', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(input),
            });
            
            if (!response.ok) {
              const error = await response.json();
              throw new Error(error.message || 'Payment processing failed');
            }
            
            return response.json();
          },
          
          async getPaymentMethods(customerId: string): Promise<PaymentMethod[]> {
            const response = await fetch('/api/payments/methods');
            
            if (!response.ok) {
              const error = await response.json();
              throw new Error(error.message || 'Failed to fetch payment methods');
            }
            
            return response.json();
          },
          
          async addPaymentMethod(customerId: string, input: AddPaymentMethodInput): Promise<PaymentMethod> {
            const response = await fetch('/api/payments/methods', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(input),
            });
            
            if (!response.ok) {
              const error = await response.json();
              throw new Error(error.message || 'Failed to add payment method');
            }
            
            return response.json();
          },
          
          async removePaymentMethod(methodId: string): Promise<void> {
            const response = await fetch(`/api/payments/methods/${methodId}`, {
              method: 'DELETE',
            });
            
            if (!response.ok) {
              const error = await response.json();
              throw new Error(error.message || 'Failed to remove payment method');
            }
          }
        };
        
        setApi(apiClient);
        setIsInitialized(true);
        
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };
    
    initializeProvider();
  }, [providerName, config]);

  const contextValue: PaymentContextType = {
    processPayment: async (input: CreatePaymentInput) => {
      if (!api) throw new Error('Payment provider not initialized');
      return api.processPayment(input);
    },
    
    getPaymentMethods: async (customerId: string) => {
      if (!api) throw new Error('Payment provider not initialized');
      return api.getPaymentMethods(customerId);
    },
    
    addPaymentMethod: async (customerId: string, input: AddPaymentMethodInput) => {
      if (!api) throw new Error('Payment provider not initialized');
      return api.addPaymentMethod(customerId, input);
    },
    
    removePaymentMethod: async (methodId: string) => {
      if (!api) throw new Error('Payment provider not initialized');
      return api.removePaymentMethod(methodId);
    },
    
    isInitialized,
    isLoading,
    error
  };

  return (
    <PaymentContext.Provider value={contextValue}>
      {children}
    </PaymentContext.Provider>
  );
}

export const usePayment = () => {
  const context = useContext(PaymentContext);
  if (!context) {
    throw new Error('usePayment must be used within a PaymentProvider');
  }
  return context;
};
