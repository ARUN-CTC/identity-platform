// Load env vars before anything (AppModule -> @prisma/client) is imported.
import 'dotenv/config';
import './common/bigint-json.polyfill';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ClsMiddleware } from 'nestjs-cls';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  // Applied directly (not via ClsModule's auto-mount) so it's guaranteed to
  // run before Nest's router — same proven pattern this was extracted from.
  app.use(new ClsMiddleware().use);
  app.enableCors();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Identity Platform API')
    .setDescription(
      'Modular, product-agnostic IAM platform: tenants, organizations, users, roles/permissions (RBAC), ' +
        'sessions, authentication, and security audit. Phase 1 baseline extracted from TravelOS — see ' +
        'docs/IDENTITY_SOURCE_INVENTORY.md and docs/TRAVELOS_COUPLING.md.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT ?? 4000);
}

bootstrap().catch((error) => {
  console.error('Application failed to start:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
