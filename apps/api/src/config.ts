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
  WECHAT_PAY_MCH_ID: z.string().optional(),
  WECHAT_PAY_API_V3_KEY: z.string().optional(),
  WECHAT_PAY_PRIVATE_KEY: z.string().optional(),
  WECHAT_PAY_PLATFORM_CERT: z.string().optional(),
  PAYMENT_WEBHOOK_BASE_URL: z.url().optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  WECHAT_APP_ID: z.string().optional(),
  WECHAT_APP_SECRET: z.string().optional(),
  PILOT_MODE: z.enum(['enabled']).optional(),
  PILOT_HOST: z.string().trim().min(1).default(PILOT_DEFAULT_HOST),
  PILOT_PORT: z.coerce.number().int().min(1).max(65_535).default(PILOT_DEFAULT_PORT),
  PILOT_PUBLIC_ORIGIN: PublicOriginSchema.optional(),
  PILOT_AUTH_PEPPER: z.string().optional(),
  PILOT_SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  PILOT_INVITE_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  PILOT_EVIDENCE_DIR: z.string().trim().min(1).optional(),
  PILOT_TRUST_PROXY: TrustedProxiesSchema.optional(),
}).superRefine((environment, context) => {
  const pilotEnabled = environment.PILOT_MODE === 'enabled';
  if (pilotEnabled) {
    const pepper = decodeCanonicalBase64(environment.PILOT_AUTH_PEPPER);
    if (!pepper || pepper.byteLength < 32) context.addIssue({
      code: 'custom', path: ['PILOT_AUTH_PEPPER'],
      message: 'PILOT_AUTH_PEPPER must be canonical Base64 containing at least 32 bytes',
    });
  }

  if (environment.NODE_ENV !== 'production') return;
  const required = pilotEnabled ? [
    'PILOT_PUBLIC_ORIGIN', 'FIELD_ENCRYPTION_KEY_V1', 'S3_ENDPOINT', 'S3_BUCKET',
    'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
  ] as const : [
    'FIELD_ENCRYPTION_KEY_V1', 'WECHAT_PAY_MCH_ID', 'WECHAT_PAY_API_V3_KEY',
    'WECHAT_PAY_PRIVATE_KEY', 'WECHAT_PAY_PLATFORM_CERT', 'PAYMENT_WEBHOOK_BASE_URL',
    'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
    'WECHAT_APP_ID', 'WECHAT_APP_SECRET',
  ] as const;
  for (const key of required) if (!environment[key]) context.addIssue({
    code: 'custom', path: [key], message: `${key} is required in production`,
  });
});

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
};

type ObjectStorageConfig = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

type ProductionConfig = {
  fieldEncryptionKey: string;
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
  pilot?: PilotConfig;
  production?: ProductionConfig;
};

export function loadConfig(environment: Record<string, string | undefined>): AppConfig {
  const parsed = EnvironmentSchema.parse(environment);
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
  } satisfies PilotConfig : undefined;

  const base: AppConfig = {
    nodeEnv: parsed.NODE_ENV,
    databaseUrl: parsed.DATABASE_URL,
    ...(parsed.FIELD_ENCRYPTION_KEY_V1
      ? { fieldEncryptionKey: parsed.FIELD_ENCRYPTION_KEY_V1 }
      : {}),
    ...(pilot ? { pilot } : {}),
  };
  if (parsed.NODE_ENV !== 'production') return base;

  const productionBase = {
    fieldEncryptionKey: parsed.FIELD_ENCRYPTION_KEY_V1!,
    objectStorage: {
      endpoint: parsed.S3_ENDPOINT!, bucket: parsed.S3_BUCKET!, accessKeyId: parsed.S3_ACCESS_KEY_ID!,
      secretAccessKey: parsed.S3_SECRET_ACCESS_KEY!,
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
