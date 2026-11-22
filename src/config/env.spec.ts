import { cargarEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/radika',
  RADIKA_API_KEYS: `${'a'.repeat(32)}, ${'b'.repeat(40)}`,
};

describe('configuracion', () => {
  test('aplica valores por defecto y separa las llaves', () => {
    const env = cargarEnv(base);
    expect(env.RADIKA_API_KEYS).toHaveLength(2);
    expect(env.PORT).toBe(3000);
    expect(env.SCHEDULER_ENABLED).toBe(true);
    expect(env.CRM_WEBHOOK_URL).toBeUndefined();
  });

  test('rechaza llaves cortas sin mostrar su valor', () => {
    expect(() => cargarEnv({ ...base, RADIKA_API_KEYS: 'corta-secreta' })).toThrow(/RADIKA_API_KEYS/);
    try {
      cargarEnv({ ...base, RADIKA_API_KEYS: 'corta-secreta' });
    } catch (error) {
      expect((error as Error).message).not.toContain('corta-secreta');
    }
  });

  test('exige secreto cuando hay webhook y https en produccion', () => {
    expect(() => cargarEnv({ ...base, CRM_WEBHOOK_URL: 'https://crm.example/hook' })).toThrow(/CRM_WEBHOOK_SECRET/);
    expect(() =>
      cargarEnv({
        ...base, NODE_ENV: 'production', CRM_WEBHOOK_URL: 'http://crm.example/hook',
        CRM_WEBHOOK_SECRET: 's'.repeat(32),
      }),
    ).toThrow(/https/);
  });

  test('falta la base de datos', () => {
    expect(() => cargarEnv({ RADIKA_API_KEYS: base.RADIKA_API_KEYS })).toThrow(/DATABASE_URL/);
  });
});
