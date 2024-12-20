// src/components/compliance/ComplianceDashboard.tsx
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Shield, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

export const ComplianceDashboard: React.FC = () => {
  const complianceStats = [
    { status: 'Compliant', count: 245, icon: CheckCircle, color: 'text-green-500' },
    { status: 'At Risk', count: 12, icon: AlertTriangle, color: 'text-yellow-500' },
    { status: 'Non-Compliant', count: 3, icon: XCircle, color: 'text-red-500' }
  ];

  const recentAlerts = [
    { id: 1, type: 'KYC', message: 'Customer verification pending', severity: 'high' },
    { id: 2, type: 'Transaction', message: 'Large transaction detected', severity: 'medium' },
    { id: 3, type: 'AML', message: 'Suspicious pattern detected', severity: 'high' }
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-6">
        {complianceStats.map((stat, index) => (
          <Card key={index}>
            <CardContent className="p-6">
              <div className="flex items-center space-x-4">
                <stat.icon className={`h-8 w-8 ${stat.color}`} />
                <div>
                  <p className="text-xl font-bold">{stat.count}</p>
                  <p className="text-gray-500">{stat.status}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Compliance Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center justify-between p-4 border rounded"
                >
                  <div>
                    <p className="font-medium">{alert.type}</p>
                    <p className="text-sm text-gray-500">{alert.message}</p>
                  </div>
                  <span className={`px-2 py-1 rounded text-sm ${
                    alert.severity === 'high' ? 'bg-red-100 text-red-800' :
                    alert.severity === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-green-100 text-green-800'
                  }`}>
                    {alert.severity}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Audits</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Add audit log content */}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};