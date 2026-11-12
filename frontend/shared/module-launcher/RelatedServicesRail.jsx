import React from 'react';
import './module-launcher.mjs';

export default function RelatedServicesRail({currentApp,services=['uonify','ecommerce','finance','inventory','transport']}){
 return <mastererp-related-services current-app={currentApp} related-apps={services.join(',')}/>;
}
