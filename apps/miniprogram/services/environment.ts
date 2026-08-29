export type MiniProgramEnvironment = 'develop' | 'trial' | 'release';

function parseBaseUrl(value: string): URL {
  try {
    const parsed = new URL(value);
    if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new Error('API_BASE_URL_MUST_BE_AN_ORIGIN');
    }
    return parsed;
  } catch (caught) {
    if (caught instanceof Error && caught.message === 'API_BASE_URL_MUST_BE_AN_ORIGIN') throw caught;
    throw new Error('INVALID_API_BASE_URL');
  }
}

function isLocal(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function resolveApiBaseUrl(input: {
  environment: MiniProgramEnvironment;
  productionBaseUrl: string;
  developmentBaseUrl?: string;
}): string {
  const selected = input.environment === 'develop' && input.developmentBaseUrl
    ? input.developmentBaseUrl
    : input.productionBaseUrl;
  const parsed = parseBaseUrl(selected);

  if (input.environment !== 'develop') {
    if (parsed.protocol !== 'https:') throw new Error('PRODUCTION_API_MUST_USE_HTTPS');
    if (isLocal(parsed.hostname)) throw new Error('PRODUCTION_API_MUST_BE_PUBLIC');
  } else if (parsed.protocol === 'http:' && !isLocal(parsed.hostname)) {
    throw new Error('DEVELOPMENT_HTTP_API_MUST_BE_LOCAL');
  } else if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('INVALID_API_PROTOCOL');
  }

  return parsed.origin;
}
