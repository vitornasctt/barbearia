import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  TZ: z.string().default('America/Sao_Paulo'),
  DATABASE_URL: z.string().min(1),
  TEST_SCHEMA: z.string().regex(/^[a-z_][a-z0-9_]*$/, 'deve ser um identificador SQL válido (minúsculas, _, dígitos)').default('test'),
  SESSION_SECRET: z.string().min(16).default('dev-secret-troque-isto-000000'),
  APP_URL: z.string().default('http://localhost:3000'),
  ADMIN_EMAIL: z.string().email().default('admin@local.test'),
  ADMIN_SENHA: z.string().min(6).default('admin123'),
  GOOGLE_MAPS_API_KEY: z.string().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_TOKEN: z.string().default(''),
  WHATSAPP_VERIFY_TOKEN: z.string().default(''),
  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  TWILIO_VERIFY_SERVICE_SID: z.string().default(''),
});

export function carregarConfig(env = process.env) {
  const r = schema.safeParse(env);
  if (!r.success) {
    const detalhe = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração de ambiente inválida — ${detalhe}`);
  }
  return r.data;
}

export const config = carregarConfig();
