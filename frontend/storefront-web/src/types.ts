export type Category = { slug: string; name: string };

export type Product = {
  id: string;
  name: string;
  description?: string;
  image_url?: string;
  brand_ref?: string;
  category_ref?: string;
  price: number;
  available: number;
};

export type StorefrontCatalog = {
  store: {
    name: string;
    modules?: string[];
    configuration?: { headline?: string };
    branding?: { primaryColor?: string };
  };
  categories: Category[];
  products: Product[];
};

export type CartLine = { product: Product; quantity: number };
