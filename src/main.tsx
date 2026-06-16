import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './styles/globals.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary name="App">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
