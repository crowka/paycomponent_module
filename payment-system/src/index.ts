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

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(rateLimiter);

// Routes
app.use('/api/payments', paymentRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/analytics', analyticsRoutes);

// Error handling
import { errorMiddleware } from './api/middleware/error.middleware';
app.use(errorMiddleware);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
