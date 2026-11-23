/**
 * Genera una clave temporal nueva para una persona, desde el servidor:
 *   node dist/cli/nueva-clave.js correo@ejemplo.com
 * Sirve cuando ningun administrador puede entrar. Cierra las sesiones abiertas de esa persona.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { UsuariosService } from '../usuarios/usuarios.service';

async function principal(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Uso: node dist/cli/nueva-clave.js <correo>');
  process.env.SCHEDULER_ENABLED = 'false';
  const { AppModule } = await import('../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const usuarios = app.get(UsuariosService);
    const persona = (await usuarios.listar()).find((usuario) => usuario.email.toLowerCase() === email);
    if (!persona) throw new Error('No hay ninguna persona con ese correo');
    const { claveTemporal } = await usuarios.administrar(persona.id, { nuevaClave: true });
    console.log(`Clave temporal de ${persona.email}: ${claveTemporal}`);
  } finally {
    await app.close();
  }
}

principal().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
