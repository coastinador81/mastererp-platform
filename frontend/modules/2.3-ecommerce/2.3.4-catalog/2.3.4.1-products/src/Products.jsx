import React from 'react';
import CatalogPage from '../../src/CatalogPage.jsx';

export default function Products({runtime}) {
  return <CatalogPage runtime={runtime} route="products"/>;
}
