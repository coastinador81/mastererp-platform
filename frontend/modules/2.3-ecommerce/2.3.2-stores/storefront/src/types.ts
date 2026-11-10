export type Category = { slug: string; name: string };

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
};

export type StorefrontCatalog = {
  store: {
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
  exchangeRate?: { rate?: number };
  payments?: Record<string, boolean>;
  paymentDetails?: {
    mobilePayment?: PaymentRecipient | null;
    bankTransfer?: PaymentRecipient | null;
    customMethods?: CustomPaymentMethod[];
  };
};

export type PayerDetails = { bankCode: string; document: string; phone?: string; holder?: string };
export type CustomerPaymentMethod = PayerDetails & { method: 'mobile' | 'transfer'; updatedAt: string };

export type CartLine = { product: Product; quantity: number };
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
