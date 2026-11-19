export type Category = { slug: string; name: string; image_url?: string };

export type Product = {
  id: string;
  name: string;
  description?: string;
  image_url?: string;
  brand_ref?: string;
  category_ref?: string;
  price: number;
  offer_price?: number;
  available: number;
  attributes?: { _catalog?: { variants?: ProductVariant[] } };
};
export type ProductVariant = { key: string; label?: string; sku?: string; price_delta?: number; active?: boolean; values?: Record<string, string> };

export type StorefrontCatalog = {
  store: {
    node_id: string;
    default_node_id: string;
    nodes: {id: string; name: string}[];
    name: string;
    modules?: string[];
    configuration?: StoreConfiguration;
    branding?: { primaryColor?: string; logoUrl?: string };
  };
  categories: Category[];
  products: Product[];
};

export type PaymentMethod = 'cash' | 'pos' | 'mobile' | 'transfer' | `custom:${string}`;
export type CustomPaymentMethod = { id: string; name: string; instructions: string; enabled: boolean };
export type PaymentRecipient = {
  document: string;
  phone?: string;
  bankCode: string;
  bankName?: string;
  accountNumber?: string;
  accountHolder?: string;
};
export type StoreConfiguration = {
  headline?: string;
  deliveryFee?: string | number;
  exchangeRate?: { base?: string; quote?: string; rate?: number; source?: string; effectiveDate?: string; updatedAt?: string };
  payments?: Record<string, boolean>;
  paymentDetails?: {
    mobilePayment?: PaymentRecipient | null;
    bankTransfer?: PaymentRecipient | null;
    customMethods?: CustomPaymentMethod[];
  };
};

export type PayerDetails = { bankCode: string; document: string; phone?: string; holder?: string };
export type CustomerPaymentMethod = PayerDetails & { method: 'mobile' | 'transfer'; updatedAt: string };

export type CartLine = { product: Product; quantity: number; variant?: ProductVariant };
export const cartLineKey = (line: Pick<CartLine, 'product' | 'variant'>) => `${line.product.id}:${line.variant?.key || ''}`;
export const cartLinePrice = (line: Pick<CartLine, 'product' | 'variant'>) => {
  const base = line.product.offer_price != null && line.product.offer_price < line.product.price ? line.product.offer_price : line.product.price;
  return base + Number(line.variant?.price_delta || 0);
};
export type CustomerProfile = { id: string; name: string; code: string; phone: string; birthDate: string; photoUrl?: string };
export type CustomerAddress = { id: string; label: string; address: string; zone: string; unit?: string; reference?: string; latitude: number; longitude: number; default: boolean; version: number };
export type CustomerOrder = {
  id: string;
  number: string;
  status: string;
  currency: string;
  total: number;
  created_at: string;
  updated_at?: string;
  delivery: Record<string, unknown>;
  payment?: Record<string, unknown>;
  items: { id: string; product_id?: string; name: string; quantity: number; unit_price: number; subtotal: number }[];
};
