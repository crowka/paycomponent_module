import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// Setup payment provider config
const providerConfig = {
  apiKey: process.env.STRIPE_PUBLIC_KEY,
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox'
};

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
