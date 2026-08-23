import { z } from 'zod';

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().startsWith('postgresql://'),
  FIELD_ENCRYPTION_KEY_V1: z.string().optional(),
  WECHAT_PAY_MCH_ID: z.string().optional(),
  WECHAT_PAY_API_V3_KEY: z.string().optional(),
  WECHAT_PAY_PRIVATE_KEY: z.string().optional(),
  WECHAT_PAY_PLATFORM_CERT: z.string().optional(),
  PAYMENT_WEBHOOK_BASE_URL: z.string().url().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  WECHAT_APP_ID: z.string().optional(),
  WECHAT_APP_SECRET: z.string().optional(),
}).superRefine((environment, context) => {
  if (environment.NODE_ENV !== 'production') return;
  const required = [
    'FIELD_ENCRYPTION_KEY_V1', 'WECHAT_PAY_MCH_ID', 'WECHAT_PAY_API_V3_KEY',
    'WECHAT_PAY_PRIVATE_KEY', 'WECHAT_PAY_PLATFORM_CERT', 'PAYMENT_WEBHOOK_BASE_URL',
    'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
    'WECHAT_APP_ID', 'WECHAT_APP_SECRET',
  ] as const;
  for (const key of required) if (!environment[key]) context.addIssue({
    code: 'custom', path: [key], message: `${key} is required in production`,
  });
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  production?: {
    fieldEncryptionKey: string;
    wechatPay: { merchantId: string; apiV3Key: string; privateKey: string; platformCertificate: string; webhookBaseUrl: string };
    objectStorage: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string };
    wechatNotifications: { appId: string; appSecret: string };
  };
};

export function loadConfig(environment: Record<string, string | undefined>): AppConfig {
  const parsed = EnvironmentSchema.parse(environment);
  const base: AppConfig = {
    nodeEnv: parsed.NODE_ENV,
    databaseUrl: parsed.DATABASE_URL,
  };
  if (parsed.NODE_ENV !== 'production') return base;
  return { ...base, production: {
    fieldEncryptionKey: parsed.FIELD_ENCRYPTION_KEY_V1!,
    wechatPay: {
      merchantId: parsed.WECHAT_PAY_MCH_ID!, apiV3Key: parsed.WECHAT_PAY_API_V3_KEY!,
      privateKey: parsed.WECHAT_PAY_PRIVATE_KEY!, platformCertificate: parsed.WECHAT_PAY_PLATFORM_CERT!,
      webhookBaseUrl: parsed.PAYMENT_WEBHOOK_BASE_URL!,
    },
    objectStorage: {
      endpoint: parsed.S3_ENDPOINT!, bucket: parsed.S3_BUCKET!, accessKeyId: parsed.S3_ACCESS_KEY_ID!,
      secretAccessKey: parsed.S3_SECRET_ACCESS_KEY!,
    },
    wechatNotifications: { appId: parsed.WECHAT_APP_ID!, appSecret: parsed.WECHAT_APP_SECRET! },
  }};
}
