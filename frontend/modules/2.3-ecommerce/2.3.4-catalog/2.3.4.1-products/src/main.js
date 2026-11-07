import React from 'react';
import {createRoot} from 'react-dom/client';
import Products from './Products.jsx';

const runtime={api:import.meta.env.VITE_PRODUCTS_API_URL||'',tenant:import.meta.env.VITE_TENANT_ID||''};
createRoot(document.querySelector('#app')).render(React.createElement(Products,{runtime}));
