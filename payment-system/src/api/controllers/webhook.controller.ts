// src/api/controllers/webhook.controller.ts

import { Request, Response } from 'express';
import { WebhookManager } from '../../lib/payment/webhooks/webhook.manager';
import { TransactionManager } from '../../lib/payment/transaction/managers/transaction.manager';
import { TransactionStatus } from '../../lib/payment/types/transaction.types';
import { PaymentLogger } from '../../lib/payment/utils/logger';
import { errorHandler } from '../../lib/payment/utils/error';
import crypto from 'crypto';
import crypto from 'crypto';

export class WebhookController {
  private logger: PaymentLogger;

  constructor(
    private webhookManager: WebhookManager,
    private transactionManager: TransactionManager,
    private providerConfig: {
      stripeWebhookSecret?: string;
      [key: string]: any;
    } = {}
  ) {
    this.logger = new PaymentLogger('info', 'WebhookController');
  }

  /**
   * Handle incoming Stripe webhook
   */
  handleStripeWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      // Get Stripe signature from headers
      const signature = req.headers['stripe-signature'] as string;
      
      if (!signature) {
        this.logger.warn('Stripe webhook received without signature');
        res.status(400).json({
          success: false,
          error: {
            code: 'missing_signature',
            message: 'Stripe signature is missing'
          }
        });
        return;
      }
      
      // Verify webhook signature if secret is configured
      if (this.providerConfig.stripeWebhookSecret) {
        try {
          this.verifyStripeSignature(
            req.body,
            signature,
            this.providerConfig.stripeWebhookSecret
          );
        } catch (error) {
          this.logger.warn('Invalid Stripe signature', { error });
          res.status(401).json({
            success: false,
            error: {
              code: 'invalid_signature',
              message: 'Invalid Stripe signature'
            }
          });
          return;
        }
      }
      
      // Log webhook event
      this.logger.info('Received Stripe webhook', {
        event: req.body.type,
        id: req.body.id
      });
      
      // Process event based on type
      const event = req.body;
      
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(event.data.object);
          break;
          
        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event.data.object);
          break;
          
        case 'charge.succeeded':
          await this.handleChargeSucceeded(event.data.object);
          break;
          
        case 'charge.failed':
          await this.handleChargeFailed(event.data.object);
          break;
        
        // Add more event types as needed
        
        default:
          this.logger.info(`Unhandled Stripe event type: ${event.type}`);
      }
      
      // Always return 200 to Stripe, even if processing fails
      // This prevents Stripe from retrying the webhook
      res.status(200).json({ received: true });
    } catch (error) {
      this.logger.error('Error processing Stripe webhook', { error });
      
      // Always return 200 to Stripe to prevent retries
      // Log the error internally for investigation
      res.status(200).json({ received: true });
      
      // Also emit an event for monitoring
      try {
        await this.webhookManager.emitEvent('webhook.processing_error', {
          provider: 'stripe',
          error: error.message,
          timestamp: new Date()
        });
      } catch (emitError) {
        this.logger.error('Failed to emit webhook error event', { error: emitError });
      }
    }
  }
  
  /**
   * Register a webhook endpoint
   */
  registerWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const { url, events, secret, metadata } = req.body;
      
      this.logger.info(`Registering webhook endpoint ${url}`, { events });
      
      // Validate URL
      if (!url || !this.isValidUrl(url)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'invalid_url',
            message: 'Invalid webhook URL'
          }
        });
        return;
      }
      
      // Validate events
      if (!events || !Array.isArray(events) || events.length === 0) {
        res.status(400).json({
          success: false,
          error: {
            code: 'invalid_events',
            message: 'Events must be a non-empty array'
          }
        });
        return;
      }
      
      // Register webhook
      const webhook = await this.webhookManager.registerEndpoint(
        url,
        events,
        {
          secret,
          metadata
        }
      );
      
      // Return success
      res.status(201).json({
        success: true,
        webhook: {
          id: webhook.id,
          url: webhook.url,
          events: webhook.events,
          createdAt: webhook.createdAt
        }
      });
    } catch (error) {
      this.logger.error('Error registering webhook', { error });
      
      // Format and return error response
      const errorResponse = errorHandler.handleControllerError(
        error,
        'Failed to register webhook'
      );
      
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  }
  
  /**
   * Get registered webhooks
   */
  getWebhooks = async (req: Request, res: Response): Promise<void> => {
    try {
      this.logger.info('Getting registered webhooks');
      
      // Get webhooks
      const webhooks = await this.webhookManager.getEndpoints();
      
      // Return webhooks
      res.status(200).json({
        success: true,
        webhooks: webhooks.map(webhook => ({
          id: webhook.id,
          url: webhook.url,
          events: webhook.events,
          active: webhook.active,
          createdAt: webhook.createdAt,
          updatedAt: webhook.updatedAt
        }))
      });
    } catch (error) {
      this.logger.error('Error getting webhooks', { error });
      
      // Format and return error response
      const errorResponse = errorHandler.handleControllerError(
        error,
        'Failed to get webhooks'
      );
      
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  }
  
  /**
   * Delete a webhook
   */
  deleteWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      
      this.logger.info(`Deleting webhook ${id}`);
      
      // Delete webhook
      const success = await this.webhookManager.deleteEndpoint(id);
      
      if (!success) {
        res.status(404).json({
          success: false,
          error: {
            code: 'webhook_not_found',
            message: `Webhook ${id} not found`
          }
        });
        return;
      }
      
      // Return success
      res.status(200).json({
        success: true,
        message: `Webhook ${id} deleted`
      });
    } catch (error) {
      this.logger.error(`Error deleting webhook ${req.params.id}`, { error });
      
      // Format and return error response
      const errorResponse = errorHandler.handleControllerError(
        error,
        'Failed to delete webhook'
      );
      
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  }
  
  /**
   * Update a webhook
   */
  updateWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { url, events, active, metadata } = req.body;
      
      this.logger.info(`Updating webhook ${id}`, { url, events, active });
      
      // Validate URL if provided
      if (url && !this.isValidUrl(url)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'invalid_url',
            message: 'Invalid webhook URL'
          }
        });
        return;
      }
      
      // Validate events if provided
      if (events && (!Array.isArray(events) || events.length === 0)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'invalid_events',
            message: 'Events must be a non-empty array'
          }
        });
        return;
      }
      
      // Update webhook
      const webhook = await this.webhookManager.updateEndpoint(
        id,
        {
          url,
          events,
          active,
          metadata
        }
      );
      
      if (!webhook) {
        res.status(404).json({
          success: false,
          error: {
            code: 'webhook_not_found',
            message: `Webhook ${id} not found`
          }
        });
        return;
      }
      
      // Return updated webhook
      res.status(200).json({
        success: true,
        webhook: {
          id: webhook.id,
          url: webhook.url,
          events: webhook.events,
          active: webhook.active,
          updatedAt: webhook.updatedAt
        }
      });
    } catch (error) {
      this.logger.error(`Error updating webhook ${req.params.id}`, { error });
      
      // Format and return error response
      const errorResponse = errorHandler.handleControllerError(
        error,
        'Failed to update webhook'
      );
      
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  }
  
  /**
   * Verify Stripe webhook signature
   */
  private verifyStripeSignature(
    payload: any,
    signature: string,
    secret: string
  ): void {
    const payloadString = JSON.stringify(payload);
    const timestampStr = signature.split(',')[0].split('=')[1];
    const timestamp = parseInt(timestampStr);
    
    if (isNaN(timestamp)) {
      throw new Error('Invalid Stripe signature timestamp');
    }
    
    // Check if webhook is too old (5 minutes)
    const now = Math.floor(Date.now() / 1000);
    if (now - timestamp > 300) {
      throw new Error('Stripe signature timestamp too old');
    }
    
    // Compute signature
    const signedPayload = `${timestamp}.${payloadString}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');
    
    // Get actual signature from header
    const actualSignature = signature.split(',')[1].split('=')[1];
    
    // Compare signatures
    if (expectedSignature !== actualSignature) {
      throw new Error('Stripe signature verification failed');
    }
  }
  
  /**
   * Handle payment intent succeeded event
   */
  private async handlePaymentIntentSucceeded(
    paymentIntent: any
  ): Promise<void> {
    try {
      this.logger.info(`Payment intent succeeded: ${paymentIntent.id}`);
      
      // Look up transaction by external ID in metadata
      const externalId = paymentIntent.id;
      const transactionId = paymentIntent.metadata?.transactionId;
      
      if (!transactionId) {
        this.logger.warn(`No transaction ID in payment intent metadata: ${externalId}`);
        return;
      }
      
      // Get transaction
      const transaction = await this.transactionManager.getTransaction(transactionId);
      
      if (!transaction) {
        this.logger.warn(`Transaction not found for payment intent: ${externalId}, transaction ID: ${transactionId}`);
        return;
      }
      
      // Ignore if transaction is already completed
      if (transaction.status === TransactionStatus.COMPLETED) {
        this.logger.info(`Transaction ${transactionId} already completed`);
        return;
      }
      
      // Update transaction status
      await this.transactionManager.updateTransactionStatus(
        transactionId,
        TransactionStatus.COMPLETED,
        {
          stripePaymentIntentId: externalId,
          stripePaymentStatus: paymentIntent.status,
          paymentMethod: paymentIntent.payment_method_types?.join(','),
          paymentMethodDetails: paymentIntent.payment_method_details
        }
      );
      
      this.logger.info(`Updated transaction ${transactionId} to COMPLETED based on webhook`);
      
      // Emit event
      await this.webhookManager.emitEvent('payment.succeeded', {
        transactionId,
        provider: 'stripe',
        externalId,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        timestamp: new Date()
      });
    } catch (error) {
      this.logger.error(`Error handling payment intent succeeded: ${paymentIntent.id}`, { error });
      
      // Emit event for monitoring
      await this.webhookManager.emitEvent('webhook.processing_error', {
        provider: 'stripe',
        eventType: 'payment_intent.succeeded',
        error: error.message,
        paymentIntentId: paymentIntent.id,
        timestamp: new Date()
      });
    }
  }
  
  /**
   * Handle payment intent failed event
   */
  private async handlePaymentIntentFailed(
    paymentIntent: any
  ): Promise<void> {
    try {
      this.logger.info(`Payment intent failed: ${paymentIntent.id}`);
      
      // Look up transaction by external ID in metadata
      const externalId = paymentIntent.id;
      const transactionId = paymentIntent.metadata?.transactionId;
      
      if (!transactionId) {
        this.logger.warn(`No transaction ID in payment intent metadata: ${externalId}`);
        return;
      }
      
      // Get transaction
      const transaction = await this.transactionManager.getTransaction(transactionId);
      
      if (!transaction) {
        this.logger.warn(`Transaction not found for payment intent: ${externalId}, transaction ID: ${transactionId}`);
        return;
      }
      
      // Ignore if transaction is already failed or completed
      if (transaction.status === TransactionStatus.FAILED || 
          transaction.status === TransactionStatus.COMPLETED) {
        this.logger.info(`Transaction ${transactionId} already in terminal state: ${transaction.status}`);
        return;
      }
      
      // Extract error information
      const error = paymentIntent.last_payment_error || {};
      const errorCode = error.code || 'payment_failed';
      const errorMessage = error.message || 'Payment failed';
      
      // Handle as transaction error with appropriate error info
      await this.transactionManager.handleTransactionError(
        transactionId,
        {
          code: errorCode,
          message: errorMessage,
          recoverable: false,
          retryable: this.isRetryableStripeError(errorCode),
          details: {
            stripePaymentIntentId: externalId,
            stripeError: error,
            declineCode: error.decline_code
          }
        }
      );
      
      this.logger.info(`Handled payment failure for transaction ${transactionId}`);
      
      // Emit event
      await this.webhookManager.emitEvent('payment.failed', {
        transactionId,
        provider: 'stripe',
        externalId,
        errorCode,
        errorMessage,
        timestamp: new Date()
      });
    } catch (error) {
      this.logger.error(`Error handling payment intent failed: ${paymentIntent.id}`, { error });
      
      // Emit event for monitoring
      await this.webhookManager.emitEvent('webhook.processing_error', {
        provider: 'stripe',
        eventType: 'payment_intent.payment_failed',
        error: error.message,
        paymentIntentId: paymentIntent.id,
        timestamp: new Date()
      });
    }
  }
  
  /**
   * Handle charge succeeded event
   */
  private async handleChargeSucceeded(charge: any): Promise<void> {
    try {
      this.logger.info(`Charge succeeded: ${charge.id}`);
      
      // For charges, we need to find the payment intent
      const paymentIntentId = charge.payment_intent;
      
      if (!paymentIntentId) {
        this.logger.info(`Charge ${charge.id} has no payment intent ID, skipping`);
        return;
      }
      
      // Get payment intent to extract metadata
      // In real implementation, this would make an API call to Stripe
      // For simplicity, we're assuming charge has the metadata
      const transactionId = charge.metadata?.transactionId;
      
      if (!transactionId) {
        this.logger.warn(`No transaction ID in charge metadata: ${charge.id}`);
        return;
      }
      
      // Process success similar to payment intent
      // This is a simplified example
      await this.handlePaymentIntentSucceeded({
        id: paymentIntentId,
        metadata: { transactionId },
        status: charge.status,
        amount: charge.amount,
        currency: charge.currency
      });
    } catch (error) {
      this.logger.error(`Error handling charge succeeded: ${charge.id}`, { error });
    }
  }
  
  /**
   * Handle charge failed event
   */
  private async handleChargeFailed(charge: any): Promise<void> {
    try {
      this.logger.info(`Charge failed: ${charge.id}`);
      
      // For charges, similar to above, find the payment intent
      const paymentIntentId = charge.payment_intent;
      
      if (!paymentIntentId) {
        this.logger.info(`Charge ${charge.id} has no payment intent ID, skipping`);
        return;
      }
      
      const transactionId = charge.metadata?.transactionId;
      
      if (!transactionId) {
        this.logger.warn(`No transaction ID in charge metadata: ${charge.id}`);
        return;
      }
      
      // Process failure similar to payment intent
      await this.handlePaymentIntentFailed({
        id: paymentIntentId,
        metadata: { transactionId },
        status: charge.status,
        last_payment_error: {
          code: charge.failure_code,
          message: charge.failure_message,
          decline_code: charge.outcome?.type
        }
      });
    } catch (error) {
      this.logger.error(`Error handling charge failed: ${charge.id}`, { error });
    }
  }
  
  /**
   * Get a single webhook
   */
  getWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      
      this.logger.info(`Getting webhook ${id}`);
      
      // Get webhook
      const webhook = await this.webhookManager.getEndpoint(id);
      
      if (!webhook) {
        res.status(404).json({
          success: false,
          error: {
            code: 'webhook_not_found',
            message: `Webhook ${id} not found`
          }
        });
        return;
      }
      
      // Return webhook
      res.status(200).json({
        success: true,
        webhook: {
          id: webhook.id,
          url: webhook.url,
          events: webhook.events,
          active: webhook.active,
          createdAt: webhook.createdAt,
          updatedAt: webhook.updatedAt
        }
      });
    } catch (error) {
      this.logger.error(`Error getting webhook ${req.params.id}`, { error });
      
      // Format and return error response
      const errorResponse = errorHandler.handleControllerError(
        error,
        'Failed to get webhook'
      );
      
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  }
  
  /**
   * Check if a Stripe error code is retryable
   */
  /**
   * Validate a URL
   */
  private isValidUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }
}
}
