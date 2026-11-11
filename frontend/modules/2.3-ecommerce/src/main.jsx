import React from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceProvider} from '../../../app-shell/src/session.jsx';
import EcommerceApp from './EcommerceApp.jsx';
import '../../../app-shell/src/shell.css';
import '../../2.2-finance/src/finance.css';
import './operations.css';
import '../../../shared/ui/application-header.css';

createRoot(document.getElementById('root')).render(
  <WorkspaceProvider><EcommerceApp /></WorkspaceProvider>,
);
