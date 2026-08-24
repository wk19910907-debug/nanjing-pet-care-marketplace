export function resolvePublicBase(value?: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    return '/';
  }

  if (!normalized.startsWith('/') || !normalized.endsWith('/')) {
    throw new Error('VITE_PUBLIC_BASE must start and end with "/"');
  }

  return normalized;
}
