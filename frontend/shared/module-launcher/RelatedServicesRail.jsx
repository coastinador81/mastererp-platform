import React from 'react';
import './module-launcher.mjs';

export const RELATED_SERVICE_IDS=['uonify','finance','ecommerce','inventory','transport','agents'];

export default function RelatedServicesRail({currentApp,services=RELATED_SERVICE_IDS}){
 return <mastererp-related-services current-app={currentApp} related-apps={services.join(',')}/>;
}
