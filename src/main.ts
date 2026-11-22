import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ENV, Env } from './config/env';

async function arrancar(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  const env = app.get<Env>(ENV);
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  await app.listen(env.PORT);
  new Logger('Radika').log(`API escuchando en el puerto ${env.PORT}`);
}

arrancar().catch((error: unknown) => {
  new Logger('Radika').error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
