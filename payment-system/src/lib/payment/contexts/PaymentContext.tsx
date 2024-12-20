import React, { createContext, useContext, useMemo } from 'react';
import { PaymentService } from '../services/payment.service';
import { 
  CreatePaymentInput, 
  PaymentResult, 
  PaymentMethod,
  AddPaymentMethodInput,
  ProviderConfig 
} from '../types/provider.types';
import { PaymentProviderFactory } from '../providers/provider-factory';

interface PaymentContextType {
  processPayment: (input: CreatePaymentInput) => Promise<PaymentResult>;
  getPaymentMethods: (customerId: string) => Promise<PaymentMethod[]>;
  addPaymentMethod: (customerId: string, input: AddPaymentMethodInput) => Promise<PaymentMethod>;
  removePaymentMethod: (methodId: string) => Promise<void>;
}

interface PaymentProviderProps {
  providerName: string;
  config: ProviderConfig;
  children: React.ReactNode;
}

const PaymentContext = createContext<PaymentContextType | null>(null);

export function PaymentProvider({ providerName, config, children }: PaymentProviderProps) {
  const paymentService = useMemo(async () => {
    const provider = await PaymentProviderFactory.createProvider(providerName, config);
    return new PaymentService(provider, { logLevel: 'info' });
  }, [providerName, config]);

  const contextValue = useMemo(() => ({
    processPayment: (input: CreatePaymentInput) => paymentService.processPayment(input),
    getPaymentMethods: (customerId: string) => paymentService.getPaymentMethods(customerId),
    addPaymentMethod: (customerId: string, input: AddPaymentMethodInput) => 
      paymentService.addPaymentMethod(customerId, input),
    removePaymentMethod: (methodId: string) => paymentService.removePaymentMethod(methodId)
  }), [paymentService]);

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