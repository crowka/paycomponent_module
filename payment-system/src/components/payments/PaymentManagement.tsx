import React from 'react';
import { PaymentForm } from './PaymentForm';
import { PaymentHistory } from './PaymentHistory';
import { PaymentMethodList } from './PaymentMethodList';
import { SubscriptionManager } from './SubscriptionManager';

export default function PaymentManagement() {
  return (
    <div className="space-y-6">
      {/* Top row: Payment Form and Subscription Manager */}
      <div className="grid grid-cols-2 gap-6">
        <PaymentForm />
        <SubscriptionManager />
      </div>

      {/* Bottom row: Payment Methods and History */}
      <div className="grid grid-cols-2 gap-6">
        <PaymentMethodList />
        <PaymentHistory />
      </div>
    </div>
  );
}