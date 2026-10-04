import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
// Loaded after every feature stylesheet so the shared ground and motion apply to all of them.
import './theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
