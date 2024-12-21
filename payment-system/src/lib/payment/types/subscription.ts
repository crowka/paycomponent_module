export interface SubscriptionPlan {
  name: string;
  price: number;
  interval: 'monthly' | 'yearly';
}

export interface Subscription {
  id: string;
  status: 'active' | 'canceled' | 'expired' | 'trial';
  plan: SubscriptionPlan;
  customerId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd?: boolean;
  trialEnd?: Date;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}
