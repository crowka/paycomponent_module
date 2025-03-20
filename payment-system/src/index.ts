// src/index.ts (updated version)
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import paymentRoutes from './api/routes/payment.routes';
import transactionRoutes from './api/routes/transaction.routes';
import customerRoutes from './api/routes/customer.routes';
import complianceRoutes from './api/routes/compliance.routes';
import analyticsRoutes from './api/routes/analytics.routes';
import { rateLimiter } from './api/middleware/rate-limiter';
import { errorMiddleware } from './api/middleware/error.middleware';
import { initializeDatabase } from './lib/payment/config/database.config';
import { EventSystemFactory } from './lib/payment/events/event-system.factory';
import { PaymentLogger } from './lib/payment/utils/logger';

// Setup logger
const logger = new PaymentLogger('info', 'App');

// Load environment variables
dotenv.config();

// Initialize database connection
const dbConnection = initializeDatabase();
logger.info('Database connection initialized');

// Initialize event system with database persistence
const { eventEmitter, eventProcessor } = EventSystemFactory.createEventSystem({
  useDatabase: true,
  dbConnection,
  startProcessor: true
});
logger.info('Event system initialized with database persistence');

// Set up Express application
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(rateLimiter);

// Add request ID middleware for tracking requests
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Routes
app.use('/api/payments', paymentRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/analytics', analyticsRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'UP',
    timestamp: new Date(),
    database: dbConnection ? 'connected' : 'disconnected',
    eventSystem: 'running'
  });
});

// Error handling
app.use(errorMiddleware);

// Start server
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  // Stop event processor
  eventProcessor.stopProcessing();
  
  // Close database connection
  await dbConnection.close();
  
  process.exit(0);
});

// Export for testing
export { app, eventEmitter, eventProcessor };
