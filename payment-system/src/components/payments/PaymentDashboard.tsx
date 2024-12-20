// src/components/payments/PaymentDashboard.tsx
import React from 'react';
import { PaymentForm } from './PaymentForm';
import { PaymentMethodList } from './PaymentMethodList';
import { RecentTransactions } from './RecentTransactions';

export const PaymentDashboard: React.FC = () => {
  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="space-y-6">
        <PaymentForm />
        <PaymentMethodList />
      </div>
      <div>
        <RecentTransactions />
      </div>
    </div>
  );
};
