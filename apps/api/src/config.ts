import { z } from 'zod';
import { isIP } from 'node:net';

const PILOT_DEFAULT_HOST = '127.0.0.1';
const PILOT_DEFAULT_PORT = 3000;

function decodeCanonicalBase64(value: string | undefined): Buffer | undefined {
  if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return undefined;
  }
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value ? decoded : undefined;
}

const PublicOriginSchema = z.url().refine((value) => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
}, 'PILOT_PUBLIC_ORIGIN must be an exact HTTP(S) origin');

const S3PublicEndpointSchema = z.url().refine((value) => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
}, 'S3_PUBLIC_ENDPOINT must be an exact HTTP(S) origin');

const TrustedProxiesSchema = z.string().trim().min(1).transform((value) => (
  value.split(',').map((entry) => entry.trim())
)).superRefine((entries, context) => {
  if (entries.length > 16) {
    context.addIssue({ code: 'custom', message: 'PILOT_TRUST_PROXY accepts at most 16 entries' });
  }
  const unique = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (!entry || unique.has(entry)) {
      context.addIssue({ code: 'custom', path: [index], message: 'PILOT_TRUST_PROXY entries must be unique IP/CIDR values' });
      continue;
    }
    unique.add(entry);
    const separator = entry.lastIndexOf('/');
    const address = separator === -1 ? entry : entry.slice(0, separator);
    const family = isIP(address);
    if (family === 0) {
      context.addIssue({ code: 'custom', path: [index], message: 'PILOT_TRUST_PROXY entries must be IP/CIDR values' });
      continue;
    }
    if (separator === -1) continue;
    const prefixText = entry.slice(separator + 1);
    const prefix = Number(prefixText);
    const maximum = family === 4 ? 32 : 128;
    if (!/^\d+$/.test(prefixText) || !Number.isInteger(prefix) || prefix < 1 || prefix > maximum) {
      context.addIssue({ code: 'custom', path: [index], message: 'PILOT_TRUST_PROXY CIDR prefix is unsafe or invalid' });
    }
  }
});

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().startsWith('postgresql://'),
  FIELD_ENCRYPTION_KEY_V1: z.string().optional(),
  FIELD_ENCRYPTION_KEYRING: z.string().max(16_384).optional(),
  FIELD_ENCRYPTION_ACTIVE_VERSION: z.string().optional(),
  WECHAT_PAY_MCH_ID: z.string().optional(),
  WECHAT_PAY_API_V3_KEY: z.string().optional(),
  WECHAT_PAY_PRIVATE_KEY: z.string().optional(),
  WECHAT_PAY_PLATFORM_CERT: z.string().optional(),
  PAYMENT_WEBHOOK_BASE_URL: z.url().optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_PUBLIC_ENDPOINT: S3PublicEndpointSchema.optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_REGION: z.string().trim().min(1).optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional(),
  WECHAT_APP_ID: z.string().optional(),
  WECHAT_APP_SECRET: z.string().optional(),
  WECHAT_LOGIN_ENABLED: z.enum(['true', 'false']).optional(),
  PILOT_MODE: z.enum(['enabled']).optional(),
  PILOT_HOST: z.string().trim().min(1).default(PILOT_DEFAULT_HOST),
  PILOT_PORT: z.coerce.number().int().min(1).max(65_535).default(PILOT_DEFAULT_PORT),
  PILOT_PUBLIC_ORIGIN: PublicOriginSchema.optional(),
  PILOT_AUTH_PEPPER: z.string().optional(),
  PILOT_SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  PILOT_INVITE_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  PILOT_EVIDENCE_DIR: z.string().trim().min(1).optional(),
  PILOT_TRUST_PROXY: TrustedProxiesSchema.optional(),
  PILOT_SHARED_INGRESS_RATE_LIMITING: z.enum(['enabled']).optional(),
}).superRefine((environment, context) => {
  const pilotEnabled = environment.PILOT_MODE === 'enabled';
  if (environment.WECHAT_LOGIN_ENABLED === 'true') {
    if (!pilotEnabled) context.addIssue({
      code: 'custom', path: ['PILOT_MODE'], message: 'PILOT_MODE is required for WeChat sessions',
    });
    for (const [key, valid] of [
      ['WECHAT_APP_ID', /^wx[a-fA-F0-9]{16}$/.test(environment.WECHAT_APP_ID ?? '')],
      ['WECHAT_APP_SECRET', /^[a-fA-F0-9]{32}$/.test(environment.WECHAT_APP_SECRET ?? '')],
    ] as const) {
      if (!valid) context.addIssue({ code: 'custom', path: [key], message: `${key} is invalid or missing` });
    }
  }
  if (pilotEnabled) {
    const pepper = decodeCanonicalBase64(environment.PILOT_AUTH_PEPPER);
    if (!pepper || pepper.byteLength < 32) context.addIssue({
      code: 'custom', path: ['PILOT_AUTH_PEPPER'],
      message: 'PILOT_AUTH_PEPPER must be canonical Base64 containing at least 32 bytes',
    });
  }

  if (environment.NODE_ENV !== 'production') return;
  if (pilotEnabled && environment.PILOT_SHARED_INGRESS_RATE_LIMITING !== 'enabled') context.addIssue({
    code: 'custom', path: ['PILOT_SHARED_INGRESS_RATE_LIMITING'], message: 'PILOT_SHARED_INGRESS_RATE_LIMITING is required in production',
  });
  const required = pilotEnabled ? [
    'PILOT_PUBLIC_ORIGIN', 'S3_ENDPOINT', 'S3_BUCKET',
    'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_REGION',
  ] as const : [
    'WECHAT_PAY_MCH_ID', 'WECHAT_PAY_API_V3_KEY',
    'WECHAT_PAY_PRIVATE_KEY', 'WECHAT_PAY_PLATFORM_CERT', 'PAYMENT_WEBHOOK_BASE_URL',
    'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_REGION',
    'WECHAT_APP_ID', 'WECHAT_APP_SECRET',
  ] as const;
  for (const key of required) if (!environment[key]) context.addIssue({
    code: 'custom', path: [key], message: `${key} is required in production`,
  });
  if (!environment.FIELD_ENCRYPTION_KEY_V1 && !environment.FIELD_ENCRYPTION_KEYRING) context.addIssue({
    code: 'custom', path: ['FIELD_ENCRYPTION_KEY_V1'], message: 'FIELD_ENCRYPTION_KEY_V1 or FIELD_ENCRYPTION_KEYRING is required in production',
  });
});

export type FieldEncryptionKeyringConfig = {
  activeVersion: number;
  keys: Map<number, string>;
};

export type PilotConfig = {
  enabled: true;
  host: string;
  port: number;
  publicOrigin?: string;
  authPepper: Buffer;
  sessionDays: number;
  inviteHours: number;
  evidenceDir?: string;
  trustedProxies?: string[];
  secureCookies: boolean;
  sharedIngressRateLimiting?: boolean;
};

export type ObjectStorageConfig = {
  endpoint: string;
  publicEndpoint?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  forcePathStyle: boolean;
};

type ProductionConfig = {
  fieldEncryptionKey?: string;
  fieldEncryptionKeyring?: FieldEncryptionKeyringConfig;
  objectStorage: ObjectStorageConfig;
  wechatPay?: {
    merchantId: string;
    apiV3Key: string;
    privateKey: string;
    platformCertificate: string;
    webhookBaseUrl: string;
  };
  wechatNotifications?: { appId: string; appSecret: string };
};

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  fieldEncryptionKey?: string;
  fieldEncryptionKeyring?: FieldEncryptionKeyringConfig;
  pilot?: PilotConfig;
  production?: ProductionConfig;
  wechatLogin?: { appId: string; appSecret: string };
};

export function loadConfig(environment: Record<string, string | undefined>): AppConfig {
  const parsed = EnvironmentSchema.parse(environment);
  const legacyFieldEncryptionKey = parseLegacyFieldEncryptionKey(parsed.FIELD_ENCRYPTION_KEY_V1);
  const fieldEncryptionKeyring = parseFieldEncryptionKeyring(
    parsed.FIELD_ENCRYPTION_KEYRING,
    parsed.FIELD_ENCRYPTION_ACTIVE_VERSION,
    legacyFieldEncryptionKey,
  );
  const pilot = parsed.PILOT_MODE === 'enabled' ? {
    enabled: true as const,
    host: parsed.PILOT_HOST,
    port: parsed.PILOT_PORT,
    ...(parsed.PILOT_PUBLIC_ORIGIN ? { publicOrigin: parsed.PILOT_PUBLIC_ORIGIN } : {}),
    authPepper: decodeCanonicalBase64(parsed.PILOT_AUTH_PEPPER)!,
    sessionDays: parsed.PILOT_SESSION_DAYS,
    inviteHours: parsed.PILOT_INVITE_HOURS,
    ...(parsed.PILOT_EVIDENCE_DIR ? { evidenceDir: parsed.PILOT_EVIDENCE_DIR } : {}),
    ...(parsed.PILOT_TRUST_PROXY ? { trustedProxies: parsed.PILOT_TRUST_PROXY } : {}),
    secureCookies: parsed.NODE_ENV === 'production',
    ...(parsed.PILOT_SHARED_INGRESS_RATE_LIMITING === 'enabled' ? { sharedIngressRateLimiting: true } : {}),
  } satisfies PilotConfig : undefined;

  const base: AppConfig = {
    nodeEnv: parsed.NODE_ENV,
    databaseUrl: parsed.DATABASE_URL,
    ...(legacyFieldEncryptionKey
      ? { fieldEncryptionKey: legacyFieldEncryptionKey }
      : {}),
    ...(fieldEncryptionKeyring ? { fieldEncryptionKeyring } : {}),
    ...(pilot ? { pilot } : {}),
    ...(parsed.WECHAT_LOGIN_ENABLED === 'true' ? {
      wechatLogin: { appId: parsed.WECHAT_APP_ID!, appSecret: parsed.WECHAT_APP_SECRET! },
    } : {}),
  };
  if (parsed.NODE_ENV !== 'production') return base;

  const productionBase = {
    ...(legacyFieldEncryptionKey ? { fieldEncryptionKey: legacyFieldEncryptionKey } : {}),
    ...(fieldEncryptionKeyring ? { fieldEncryptionKeyring } : {}),
    objectStorage: {
      endpoint: parsed.S3_ENDPOINT!, bucket: parsed.S3_BUCKET!, accessKeyId: parsed.S3_ACCESS_KEY_ID!,
      ...(parsed.S3_PUBLIC_ENDPOINT ? { publicEndpoint: parsed.S3_PUBLIC_ENDPOINT } : {}),
      secretAccessKey: parsed.S3_SECRET_ACCESS_KEY!, region: parsed.S3_REGION!,
      forcePathStyle: parsed.S3_FORCE_PATH_STYLE === 'true',
    },
  };
  if (pilot) return { ...base, production: productionBase };

  return { ...base, production: {
    ...productionBase,
    wechatPay: {
      merchantId: parsed.WECHAT_PAY_MCH_ID!, apiV3Key: parsed.WECHAT_PAY_API_V3_KEY!,
      privateKey: parsed.WECHAT_PAY_PRIVATE_KEY!, platformCertificate: parsed.WECHAT_PAY_PLATFORM_CERT!,
      webhookBaseUrl: parsed.PAYMENT_WEBHOOK_BASE_URL!,
    },
    wechatNotifications: { appId: parsed.WECHAT_APP_ID!, appSecret: parsed.WECHAT_APP_SECRET! },
  }};
}

function parseLegacyFieldEncryptionKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!isCanonicalFieldKey(value)) throw new Error('FIELD_ENCRYPTION_KEY_V1_INVALID');
  return value;
}

function parseFieldEncryptionKeyring(
  encoded: string | undefined,
  activeVersionText: string | undefined,
  legacyKey: string | undefined,
): FieldEncryptionKeyringConfig | undefined {
  if (!encoded && !activeVersionText) return undefined;
  if (!encoded || !activeVersionText || legacyKey) throw new Error('FIELD_ENCRYPTION_KEYRING_INVALID');
  if (!/^[1-9]\d{0,9}$/.test(activeVersionText)) throw new Error('FIELD_ENCRYPTION_ACTIVE_VERSION_INVALID');
  const activeVersion = Number(activeVersionText);
  if (!Number.isSafeInteger(activeVersion) || activeVersion > 2_147_483_647) {
    throw new Error('FIELD_ENCRYPTION_ACTIVE_VERSION_INVALID');
  }
  let entries: unknown;
  try { entries = JSON.parse(encoded); }
  catch { throw new Error('FIELD_ENCRYPTION_KEYRING_INVALID'); }
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 16) {
    throw new Error('FIELD_ENCRYPTION_KEYRING_INVALID');
  }
  const keys = new Map<number, string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('FIELD_ENCRYPTION_KEYRING_INVALID');
    const object = entry as Record<string, unknown>;
    const version = object.version;
    const key = object.key;
    if (Object.keys(object).length !== 2 || !Object.hasOwn(object, 'version') || !Object.hasOwn(object, 'key')
      || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647
      || typeof key !== 'string' || keys.has(version) || !isCanonicalFieldKey(key)) {
      throw new Error('FIELD_ENCRYPTION_KEYRING_INVALID');
    }
    keys.set(version, key);
  }
  if (!keys.has(activeVersion)) throw new Error('FIELD_ENCRYPTION_ACTIVE_VERSION_INVALID');
  return { activeVersion, keys };
}

function isCanonicalFieldKey(value: string): boolean {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64');
  return decoded.byteLength === 32 && decoded.toString('base64') === value;
}
