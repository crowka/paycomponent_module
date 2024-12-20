import { useEffect } from 'react';
import { usePayment } from '@/lib/hooks/usePayment';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Alert } from '../ui/alert';
import { DataTable } from '../common/DataTable';
import { Badge } from '../ui/badge';

export function PaymentHistory() {
  const { paymentHistory, isLoading, error, fetchPaymentHistory } = usePayment();

  useEffect(() => {
    fetchPaymentHistory();
  }, [fetchPaymentHistory]);

  if (isLoading) {
    return <div>Loading payment history...</div>;
  }

  if (error) {
    return <Alert variant="destructive">{error}</Alert>;
  }

  const columns = [
    {
      key: 'date',
      header: 'Date',
      sortable: true,
    },
    {
      key: 'description',
      header: 'Description',
      sortable: true,
    },
    {
      key: 'amount',
      header: 'Amount',
      sortable: true,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (status: string) => (
        <Badge
          variant={
            status === 'succeeded'
              ? 'success'
              : status === 'failed'
              ? 'destructive'
              : 'secondary'
          }
        >
          {status}
        </Badge>
      ),
    },
  ];

  const formattedHistory = paymentHistory.map(payment => ({
    ...payment,
    date: new Date(payment.date).toLocaleDateString(),
    amount: `$${payment.amount.toFixed(2)}`,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment History</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          data={formattedHistory}
          columns={columns}
          searchable={true}
        />
      </CardContent>
    </Card>
  );
}