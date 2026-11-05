import React from 'react';
import {createRoot} from 'react-dom/client';
import Orders from './Orders.jsx';

const runtime={api:import.meta.env.VITE_ORDERS_API_URL||'',tenant:import.meta.env.VITE_TENANT_ID||'',company:import.meta.env.VITE_COMPANY_ID||''};
createRoot(document.querySelector('#app')).render(React.createElement(Orders,{runtime}));
