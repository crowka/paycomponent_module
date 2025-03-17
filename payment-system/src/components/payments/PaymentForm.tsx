// src/components/payments/PaymentForm.tsx
import React, { useState } from 'react';
import { usePayment } from '../../hooks/usePayment';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Alert } from '../ui/alert';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';

export function PaymentForm() {
  const { processPayment, isLoading, error } = usePayment();
  const [formData, setFormData] = useState({
    cardNumber: '',
    cardholderName: '',
    expiryDate: '',
    cvv: '',
    amount: '',
    currency: 'USD'
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Clear error when field is updated
    if (formErrors[name]) {
      setFormErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    
    if (!formData.cardNumber || formData.cardNumber.length < 16) {
      errors.cardNumber = 'Valid card number is required';
    }
    
    if (!formData.cardholderName) {
      errors.cardholderName = 'Cardholder name is required';
    }
    
    if (!formData.expiryDate || !/^\d{2}\/\d{2}$/.test(formData.expiryDate)) {
      errors.expiryDate = 'Valid expiry date (MM/YY) is required';
    }
    
    if (!formData.cvv || formData.cvv.length < 3) {
      errors.cvv = 'Valid CVV is required';
    }
    
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      errors.amount = 'Valid amount is required';
    }
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    try {
      const [month, year] = formData.expiryDate.split('/');
      
      await processPayment({
        amount: parseFloat(formData.amount),
        currency: formData.currency,
        paymentMethod: {
          type: 'card',
          details: {
            number: formData.cardNumber,
            exp_month: parseInt(month, 10),
            exp_year: parseInt(`20${year}`, 10),
            cvc: formData.cvv,
            name: formData.cardholderName
          }
        }
      });
      
      // Reset form on success
      setFormData({
        cardNumber: '',
        cardholderName: '',
        expiryDate: '',
        cvv: '',
        amount: '',
        currency: 'USD'
      });
      
    } catch (err) {
      // Error is handled by usePayment hook
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Make a Payment</CardTitle>
      </CardHeader>
      <CardContent>
        {error && <Alert variant="destructive" className="mb-4">{error}</Alert>}
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
            <div className="flex">
              <select
                name="currency"
                value={formData.currency}
                onChange={handleChange}
                className="rounded-l-md border border-r-0 border-gray-300 px-3 py-2"
              >
                <option value="USD">$</option>
                <option value="EUR">€</option>
                <option value="GBP">£</option>
              </select>
              <Input
                id="amount"
                name="amount"
                type="number"
                value={formData.amount}
                onChange={handleChange}
                className="rounded-l-none"
                placeholder="0.00"
                step="0.01"
                min="0.01"
                error={!!formErrors.amount}
              />
            </div>
            {formErrors.amount && (
              <p className="text-sm text-red-500">{formErrors.amount}</p>
            )}
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="cardholderName">Cardholder Name</Label>
            <Input
              id="cardholderName"
              name="cardholderName"
              value={formData.cardholderName}
              onChange={handleChange}
              placeholder="John Doe"
              error={!!formErrors.cardholderName}
            />
            {formErrors.cardholderName && (
              <p className="text-sm text-red-500">{formErrors.cardholderName}</p>
            )}
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="cardNumber">Card Number</Label>
            <Input
              id="cardNumber"
              name="cardNumber"
              value={formData.cardNumber}
              onChange={handleChange}
              placeholder="1234 5678 9012 3456"
              error={!!formErrors.cardNumber}
            />
            {formErrors.cardNumber && (
              <p className="text-sm text-red-500">{formErrors.cardNumber}</p>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="expiryDate">Expiry Date</Label>
              <Input
                id="expiryDate"
                name="expiryDate"
                value={formData.expiryDate}
                onChange={handleChange}
                placeholder="MM/YY"
                error={!!formErrors.expiryDate}
              />
              {formErrors.expiryDate && (
                <p className="text-sm text-red-500">{formErrors.expiryDate}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="cvv">CVV</Label>
              <Input
                id="cvv"
                name="cvv"
                type="password"
                value={formData.cvv}
                onChange={handleChange}
                placeholder="123"
                error={!!formErrors.cvv}
              />
              {formErrors.cvv && (
                <p className="text-sm text-red-500">{formErrors.cvv}</p>
              )}
            </div>
          </div>
          
          <Button
            type="submit"
            className="w-full"
            disabled={isLoading}
          >
            {isLoading ? 'Processing...' : 'Pay Now'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
