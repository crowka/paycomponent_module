import { useEffect } from 'react';
import { usePayment } from '@/hooks/usePayment';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Alert } from '../ui/alert';
import { Calendar, CheckCircle, XCircle } from 'lucide-react';

export function SubscriptionManager() {
  const { activeSubscription, isLoading, error, fetchSubscription, cancelSubscription } = usePayment();

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  if (isLoading) {
    return <div>Loading subscription details...</div>;
  }

  if (error) {
    return <Alert variant="destructive">{error}</Alert>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscription</CardTitle>
      </CardHeader>
      <CardContent>
        {activeSubscription ? (
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <span className="font-medium">{activeSubscription.plan.name}</span>
            </div>
            
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Status: {activeSubscription.status}
              </p>
              <p className="text-sm text-muted-foreground">
                Price: ${activeSubscription.plan.price}/{activeSubscription.plan.interval}
              </p>
              <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>
                  Renews on {new Date(activeSubscription.currentPeriodEnd).toLocaleDateString()}
                </span>
              </div>
            </div>

            <Button
              variant="destructive"
              onClick={cancelSubscription}
              className="w-full"
            >
              Cancel Subscription
            </Button>
          </div>
        ) : (
          <div className="text-center">
            <XCircle className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-muted-foreground">No active subscription</p>
            <Button className="mt-4">Choose a Plan</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
