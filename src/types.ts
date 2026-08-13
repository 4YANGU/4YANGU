export type Profile = {
  user_id: string;
  email: string | null;
  phone: string | null;
  full_name: string;
  role: 'founder' | 'owner';
  store_id: number | null;
};

export type Store = {
  id: number;
  name: string;
  slug: string;
  owner_name: string;
  owner_email: string;
  whatsapp: string;
  phone: string;
  logo_url: string;
  categories: string[];
  design_json: Record<string, unknown> & { storefront_html?: string };
  is_active: boolean;
  billing_started_at: string | null;
  billing_paid_until: string | null;
  visitor_total: number;
  visitor_today: number;
  orders_total: number;
  orders_today: number;
  metrics_date: string;
  created_at: string;
};

export type Product = {
  id: number;
  store_id: number;
  name: string;
  price: number;
  category: string;
  colors: string[];
  sizes: string[];
  image_url: string;
  images: string[];
  views_total: number;
  views_today: number;
  orders_total: number;
  orders_today: number;
  metrics_date: string;
  active: boolean;
  created_at: string;
};

export type Application = {
  id: number;
  name: string;
  phone: string;
  status: 'new' | 'contacted' | 'approved' | 'closed';
  created_at: string;
};

export type DashboardData = {
  profile: Profile;
  analytics?: {
    activeStores: number;
    visitors: number;
    visitorsToday: number;
    orders: number;
    ordersToday: number;
    products: number;
  };
  stores?: Store[];
  applications?: Application[];
  store?: Store;
  products?: Product[];
  notifications?: Array<{ id: number; batch_key?: string; title: string; body: string; status: string; created_at: string; winner_product?: Product | null; needs_product?: Product | null }>;
};
