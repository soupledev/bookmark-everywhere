import { reactRootOptions } from '@/src/instrument';

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './style.css';

ReactDOM.createRoot(document.getElementById('root')!, reactRootOptions).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
