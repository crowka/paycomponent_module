// src/components/dashboard/Sidebar.tsx
import { Home, CreditCard, DollarSign, Users, Activity, Shield } from 'lucide-react';

export const Sidebar: React.FC = () => {
  const menuItems = [
    { icon: Home, label: 'Dashboard', path: '/' },
    { icon: CreditCard, label: 'Payments', path: '/payments' },
    { icon: DollarSign, label: 'Transactions', path: '/transactions' },
    { icon: Users, label: 'Customers', path: '/customers' },
    { icon: Activity, label: 'Analytics', path: '/analytics' },
    { icon: Shield, label: 'Compliance', path: '/compliance' }
  ];

  return (
    <div className="fixed left-0 top-0 h-full w-64 bg-white border-r border-gray-200">
      <div className="p-6">
        <h1 className="text-2xl font-bold">Payment System</h1>
      </div>
      <nav className="mt-6">
        {menuItems.map((item) => (
          <a
            key={item.path}
            href={item.path}
            className="flex items-center px-6 py-3 text-gray-700 hover:bg-gray-100"
          >
            <item.icon className="h-5 w-5 mr-3" />
            {item.label}
          </a>
        ))}
      </nav>
    </div>
  );
};
