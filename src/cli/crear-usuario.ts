/**
 * Crea el primer administrador (o cualquier usuario) desde el servidor:
 *   node dist/cli/crear-usuario.js correo@ejemplo.com "Nombre Apellido" ADMIN
 * Imprime una clave temporal que la persona debe cambiar al entrar.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ROLES, Rol } from '../usuarios/usuario.entity';
import { UsuariosService } from '../usuarios/usuarios.service';

async function principal(): Promise<void> {
  const [email, nombre, rol = 'ASESOR'] = process.argv.slice(2);
  if (!email || !nombre || !ROLES.includes(rol as Rol)) {
    throw new Error('Uso: node dist/cli/crear-usuario.js <correo> "<nombre>" [ADMIN|ASESOR]');
  }
  process.env.SCHEDULER_ENABLED = 'false';
  const { AppModule } = await import('../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const { usuario, claveTemporal } = await app.get(UsuariosService).crear({ email, nombre, rol: rol as Rol });
    console.log(`Usuario creado: ${usuario.email} (${usuario.rol})`);
    console.log(`Clave temporal: ${claveTemporal}`);
  } finally {
    await app.close();
  }
}

principal().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
