import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { dirname, join } from 'node:path';
import { AppModule } from './app.module';
import { ENV, Env } from './config/env';

async function arrancar(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  const env = app.get<Env>(ENV);
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  // Las pantallas no cargan nada de otros sitios ni se pueden incrustar en otra pagina.
  app.use((_peticion: Request, respuesta: Response, siguiente: NextFunction) => {
    respuesta.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    respuesta.setHeader('X-Content-Type-Options', 'nosniff');
    respuesta.setHeader('Referrer-Policy', 'no-referrer');
    if (env.NODE_ENV === 'production') respuesta.setHeader('Strict-Transport-Security', 'max-age=31536000');
    siguiente();
  });
  app.useStaticAssets(join(__dirname, '..', 'public'), { index: 'index.html', maxAge: '5m' });
  // Lector de PDF para el visor propio (pantallas tactiles). Se sirve desde este mismo sitio: la politica de contenido no admite otros.
  app.useStaticAssets(dirname(require.resolve('pdfjs-dist/package.json')), { prefix: '/vendor/pdfjs/', index: false, maxAge: '7d' });
  await app.listen(env.PORT);
  new Logger('Radika').log(`API escuchando en el puerto ${env.PORT}`);
}

arrancar().catch((error: unknown) => {
  new Logger('Radika').error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
