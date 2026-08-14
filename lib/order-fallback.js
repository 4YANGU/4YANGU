const PREFIX = 'confirmed-order:';

export const missingOrdersTable = (error) => Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || /orders.*(?:does not exist|schema cache|relation)/i.test(error.message || '')));

export function encodeFallbackOrder(order) {
  return PREFIX + Buffer.from(JSON.stringify(order), 'utf8').toString('base64url');
}

export function decodeFallbackOrder(row) {
  const value = String(row?.session_id || '');
  if (!value.startsWith(PREFIX)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value.slice(PREFIX.length), 'base64url').toString('utf8'));
    return { ...parsed, id: -Number(row.id), source: 'event', store_id: Number(row.store_id), product_id: Number(row.product_id || parsed.product_id || 0), created_at: row.created_at, updated_at: parsed.updated_at || row.created_at };
  } catch {
    return null;
  }
}

export async function fallbackOrders(supabase, storeId, limit = 200) {
  const { data, error } = await supabase.from('store_events').select('id,store_id,product_id,event_type,session_id,created_at').eq('store_id', storeId).eq('event_type', 'confirmed_order').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []).map(decodeFallbackOrder).filter(Boolean);
}

export async function storeOrders(supabase, storeId, limit = 200) {
  const primary = await supabase.from('orders').select('*').eq('store_id', storeId).order('created_at', { ascending: false }).limit(limit);
  const fallback = await fallbackOrders(supabase, storeId, limit).catch(() => []);
  if (primary.error && !missingOrdersTable(primary.error)) throw primary.error;
  const rows = primary.error ? [] : primary.data || [];
  const keys = new Set(rows.map((order) => order.order_key));
  return [...rows, ...fallback.filter((order) => !keys.has(order.order_key))].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, limit);
}

export async function saveFallbackOrder(supabase, values) {
  const stored = { ...values, status: values.status || 'new', updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from('store_events').insert({ store_id: values.store_id, product_id: values.product_id, event_type: 'confirmed_order', session_id: encodeFallbackOrder(stored) }).select().single();
  if (error) throw error;
  return decodeFallbackOrder(data);
}

export async function updateFallbackOrder(supabase, negativeId, status) {
  const id = Math.abs(Number(negativeId));
  const { data: row, error } = await supabase.from('store_events').select('*').eq('id', id).eq('event_type', 'confirmed_order').single();
  if (error || !row) return null;
  const order = decodeFallbackOrder(row);
  if (!order) return null;
  const next = { ...order, id: undefined, source: undefined, status, updated_at: new Date().toISOString() };
  const { data, error: updateError } = await supabase.from('store_events').update({ session_id: encodeFallbackOrder(next) }).eq('id', id).select().single();
  if (updateError) throw updateError;
  return decodeFallbackOrder(data);
}
