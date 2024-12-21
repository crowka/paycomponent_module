import { PaymentManagement } from './components/payments';
import { AnalyticsDashboard } from './components/analytics/AnalyticsDashboard';
import { ComplianceDashboard } from './components/compliance/ComplianceDashboard';
import { PaymentDashboard } from './components/payments/PaymentDashboard';

import { initializePaymentSystem } from './lib/payment/container';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

// Initialize payment system
const paymentService = initializePaymentSystem(supabaseClient);

// Now you can use paymentService throughout your application
export { paymentService };


export interface DashboardRoute {
  path: string;
  component: React.ComponentType;
  label: string;
  icon?: React.ComponentType;
}

export const DashboardRoutes: DashboardRoute[] = [
  {
    path: '/payments',
    component: PaymentManagement,
    label: 'Payment Management'
  },
  {
    path: '/analytics',
    component: AnalyticsDashboard,
    label: 'Analytics'
  },
  {
    path: '/compliance',
    component: ComplianceDashboard,
    label: 'Compliance'
  },
  {
    path: '/payment-dashboard',
    component: PaymentDashboard,
    label: 'Payment Dashboard'
  }
];
