// src/components/payments/PaymentMethodList.tsx
import { useEffect } from 'react';
import { usePayment } from '../../hooks/usePayment';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Alert } from '../ui/alert';
import { CreditCard, Trash2 } from 'lucide-react';

export function PaymentMethodList() {
  const { 
    paymentMethods, 
    isLoading, 
    error, 
    fetchPaymentMethods, 
    removePaymentMethod 
  } = usePayment();

  useEffect(() => {
    fetchPaymentMethods();
  }, [fetchPaymentMethods]);

  if (isLoading) {
    return <div>Loading payment methods...</div>;
  }

  if (error) {
    return <Alert variant="destructive">{error}</Alert>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment Methods</CardTitle>
      </CardHeader>
      <CardContent>
        {paymentMethods.length === 0 ? (
          <p className="text-muted-foreground">No payment methods added yet.</p>
        ) : (
          <div className="space-y-4">
            {paymentMethods.map((method) => (
              <div
                key={method.id}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div className="flex items-center space-x-4">
                  <CreditCard className="h-6 w-6" />
                  <div>
                    <p className="font-medium">
                      {method.details.brand || 'Card'} •••• {method.details.last4 || '****'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {method.details.expiryMonth && method.details.expiryYear 
                        ? `Expires ${method.details.expiryMonth}/${method.details.expiryYear}`
                        : 'No expiry date'}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removePaymentMethod(method.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
