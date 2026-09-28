export function readableMessage(value: unknown): string {
  if (typeof value === 'string') {
    if (value === '[object Object]') return 'Comment details unavailable';
    if (value.startsWith('{')) { try { return readableMessage(JSON.parse(value)); } catch { /* plain text */ } }
    return value;
  }
  if (Array.isArray(value)) return value.map(readableMessage).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    for (const key of ['text', 'message', 'comment', 'content', 'body', 'description', 'title']) {
      if (item[key]) return readableMessage(item[key]);
    }
    return 'Message details unavailable';
  }
  return value == null ? '' : String(value);
}
