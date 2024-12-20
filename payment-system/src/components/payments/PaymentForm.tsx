import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { loadStripe } from '@stripe/stripe-js';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Alert } from '../ui/alert';
import { useToast } from '@/lib/hooks/useToast';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);

const paymentSchema = z.object({
  cardNumber: z.string().min(16).max(16),
  expiryDate: z.string().regex(/^(0[1-9]|1[0-2])\/([0-9]{2})$/),
  cvv: z.string().min(3).max(4),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

export function PaymentForm() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
  });

  const onSubmit = async (data: PaymentFormData) => {
    try {
      setIsProcessing(true);
      const stripe = await stripePromise;
      if (!stripe) throw new Error('Stripe failed to load');

      // Process payment logic here
      showToast('Payment successful!', 'success');
    } catch (error) {
      showToast('Payment failed', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="cardNumber">{t('payment.cardNumber')}</Label>
        <Input
          id="cardNumber"
          {...register('cardNumber')}
          placeholder="1234 5678 9012 3456"
        />
        {errors.cardNumber && (
          <Alert variant="destructive">{errors.cardNumber.message}</Alert>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="expiryDate">{t('payment.expiryDate')}</Label>
          <Input
            id="expiryDate"
            {...register('expiryDate')}
            placeholder="MM/YY"
          />
          {errors.expiryDate && (
            <Alert variant="destructive">{errors.expiryDate.message}</Alert>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="cvv">{t('payment.cvv')}</Label>
          <Input
            id="cvv"
            type="password"
            {...register('cvv')}
            placeholder="123"
          />
          {errors.cvv && (
            <Alert variant="destructive">{errors.cvv.message}</Alert>
          )}
        </div>
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={isProcessing}
      >
        {isProcessing ? t('common.loading') : t('payment.submit')}
      </Button>
    </form>
  );
}
