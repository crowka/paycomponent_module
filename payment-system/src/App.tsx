import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { DashboardLayout } from './components/dashboard/Layout';
import { useState } from 'react';

import { PaymentManagement } from './components/payment';
import { AnalyticsDashboard } from './components/analytics/AnalyticsDashboard';
import { ComplianceDashboard } from './components/compliance/ComplianceDashboard';



// Import our dashboard components
import { PaymentDashboard } from './components/payments/PaymentDashboard';
import { AnalyticsDashboard } from './components/analytics/AnalyticsDashboard';
import { ComplianceDashboard } from './components/compliance/ComplianceDashboard';

export default function App() {
  const [currentUser, setCurrentUser] = useState({
    id: '1',
    name: 'Test User',
    email: 'test@example.com'
  });

  return (
    <Router>
      <DashboardLayout>
        <Routes>
          <Route path="/" element={<MainDashboard />} />
          <Route path="/payments" element={<PaymentDashboard />} />
          <Route path="/analytics" element={<AnalyticsDashboard />} />
          <Route path="/compliance" element={<ComplianceDashboard />} />
        </Routes>
      </DashboardLayout>
    </Router>
  );
}

const MainDashboard = () => {
  const stats = [
    { label: 'Total Transactions', value: '$12,345' },
    { label: 'Success Rate', value: '99.9%' },
    { label: 'Active Users', value: '1,234' }
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-6">
        {stats.map((stat, index) => (
          <div key={index} className="p-6 bg-white rounded-lg shadow">
            <p className="text-gray-600">{stat.label}</p>
            <p className="text-2xl font-bold mt-2">{stat.value}</p>
          </div>
        ))}
      </div>
      
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-4">Recent Transactions</h2>
          <RecentTransactionsList />
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-4">System Status</h2>
          <SystemStatus />
        </div>
      </div>
    </div>
  );
};

const RecentTransactionsList = () => {
  const transactions = [
    { id: 1, amount: '$100', status: 'success', date: '2024-03-20' },
    { id: 2, amount: '$75', status: 'pending', date: '2024-03-19' },
    { id: 3, amount: '$200', status: 'success', date: '2024-03-18' }
  ];

  return (
    <div className="space-y-4">
      {transactions.map((tx) => (
        <div key={tx.id} className="flex justify-between items-center border-b pb-2">
          <div>
            <p className="font-medium">{tx.amount}</p>
            <p className="text-sm text-gray-500">{tx.date}</p>
          </div>
          <span className={`px-2 py-1 rounded text-sm ${
            tx.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
          }`}>
            {tx.status}
          </span>
        </div>
      ))}
    </div>
  );
};

const SystemStatus = () => {
  const services = [
    { name: 'Payment Processing', status: 'operational' },
    { name: 'Webhooks', status: 'operational' },
    { name: 'API', status: 'operational' }
  ];

  return (
    <div className="space-y-4">
      {services.map((service, index) => (
        <div key={index} className="flex justify-between items-center">
          <span>{service.name}</span>
          <span className="flex items-center">
            <span className={`w-2 h-2 rounded-full mr-2 ${
              service.status === 'operational' ? 'bg-green-500' : 'bg-red-500'
            }`} />
            {service.status}
          </span>
        </div>
      ))}
    </div>
  );
};
export default function App() {
  return (
    <Router>
      <DashboardLayout>
        <Routes>
          <Route path="/" element={<MainDashboard />} />
          <Route path="/payments" element={<PaymentManagement />} />
          <Route path="/analytics" element={<AnalyticsDashboard />} />
          <Route path="/compliance" element={<ComplianceDashboard />} />
        </Routes>
      </DashboardLayout>
    </Router>
  );
}