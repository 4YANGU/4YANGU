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
  groupings?: string[];
  design_json: Record<string, unknown> & { storefront_html?: string };
  is_active: boolean;
  billing_started_at: string | null;
  billing_paid_until: string | null;
  visitor_total: number;
  visitor_today: number;
  orders_total: number;
  orders_today: number;
  actual_orders_total?: number;
  orders_this_period?: number;
  upkeep_plan?: 'TRIAL' | 'PAID';
  upkeep_due?: 0 | 300;
  upkeep_paid?: boolean;
  management_locked?: boolean;
  upkeep_period_starts_at?: string;
  upkeep_period_ends_at?: string;
  metrics_date: string;
  created_at: string;
};

export type Order = {
  id: number;
  order_key: string;
  store_id: number;
  product_id: number;
  product_name: string;
  product_price: number;
  customer_phone: string;
  color: string;
  size: string;
  fulfilment: string;
  note: string;
  status: 'new' | 'contacted' | 'completed' | 'cancelled';
  created_at: string;
  updated_at: string;
};

export type Product = {
  id: number;
  store_id: number;
  name: string;
  price: number;
  legacyGrouping?: string;
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

export type SocialPlatform = 'tiktok' | 'facebook' | 'instagram' | 'youtube' | 'threads';

export type SocialConnection = {
  id: number;
  store_id: number;
  platform: string;
  account_handle: string;
  account_id: string | null;
  connection_status: string;
  auth_payload: Record<string, unknown>;
  connected_at: string;
  updated_at: string;
};

export type SocialPost = {
  id: number;
  store_id: number;
  caption: string;
  media_urls: string[];
  platforms: string[];
  status: string;
  results: Record<string, unknown>;
  scheduled_at: string | null;
  posted_at: string | null;
  created_at: string;
};

export type SocialMessage = {
  id: number;
  store_id: number;
  platform: string;
  kind: string;
  thread_key: string;
  sender_name: string;
  sender_handle: string | null;
  body: string;
  direction: 'in' | 'out';
  is_read: boolean;
  is_resolved: boolean;
  external_id: string | null;
  post_ref: string;
  post_title: string;
  post_url: string;
  sender_avatar: string | null;
  created_at: string;
};

export type SocialThread = {
  thread_key: string;
  platform: string;
  kind: string;
  sender_name: string;
  sender_handle: string | null;
  sender_avatar: string | null;
  last_body: string;
  last_at: string;
  unread: number;
  resolved: boolean;
  source_ref: string;
  source_title: string;
  source_url: string;
  messages: SocialMessage[];
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
    customers: number;
    customersToday: number;
  };
  stores?: Store[];
  applications?: Application[];
  store?: Store;
  products?: Product[];
  orders?: Order[];
  notifications?: Array<{ id: number; batch_key?: string; title: string; body: string; status: string; created_at: string; winner_product?: Product | null; needs_product?: Product | null }>;
  customers?: number;
};
