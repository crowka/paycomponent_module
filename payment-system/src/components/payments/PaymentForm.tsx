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
              <p className="text-sm text-re
  );
}
