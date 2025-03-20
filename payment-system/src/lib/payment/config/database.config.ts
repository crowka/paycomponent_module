// src/lib/payment/config/database.config.ts
import { DatabaseConnection } from '../database/connection';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Supabase API key and URL
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zuunosajfzzodzhqtcdi.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1dW5vc2FqZnp6b2R6aHF0Y2RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI0NjkyNDcsImV4cCI6MjA1ODA0NTI0N30.2y5z_29nnaPp7D15zc4IWx199TujpVY1ulKZFLrw6BM';

// Initialize the database connection
export const initializeDatabase = (): DatabaseConnection => {
  const config = {
    host: SUPABASE_URL,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: SUPABASE_KEY,
    ssl: { rejectUnauthorized: false }, // Required for Supabase connections
    max: parseInt(process.env.DB_POOL_SIZE || '10'),
    idleTimeoutMillis: 30000
  };

  return DatabaseConnection.getInstance(config);
};

// Create a function to get a connection to the database
export const getDbConnection = (): DatabaseConnection => {
  return DatabaseConnection.getInstance();
};
