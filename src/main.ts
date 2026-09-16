// Load env vars before anything (AppModule -> @prisma/client) is imported.
import 'dotenv/config';
import './common/bigint-json.polyfill';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { ClsMiddleware } from 'nestjs-cls';
import { AppModule } from './app.module';
import { parseCorsAllowedOrigins } from './config/cors.config';
import { securityHeadersOptions } from './config/security-headers.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  // Phase 3.1 (production hardening) — see security-headers.config.ts for
  // the full rationale (why CSP is off, why every other helmet default is
  // safe here) and for how this same configuration is exercised by a real
  // e2e test.
  app.use(helmet(securityHeadersOptions()));

  // Applied directly (not via ClsModule's auto-mount) so it's guaranteed to
  // run before Nest's router — same proven pattern this was extracted from.
  app.use(new ClsMiddleware().use);
  // Phase 2D.11 (docs/PRODUCTION_READINESS.md §Configuration) — previously
  // `app.enableCors()` with no options at all, meaning EVERY origin was
  // reflected and allowed unconditionally, in every environment including
  // production. `CORS_ALLOWED_ORIGINS` (comma-separated) now gates this:
  // unset means "reflect any origin" (harmless in local development, and
  // the previous, unchanged default for it), but `validateProductionConfig`
  // (Phase 2D.9/2D.11) refuses to boot in production without it explicitly
  // set — this app never relies on cookies for authentication (bearer
  // tokens only, verified by source review), so this is a defense-in-depth
  // reduction of API surface exposed to arbitrary browser-script origins,
  // not a fix for a credentialed-cookie CSRF-class defect that does not
  // exist here.
  const allowedOrigins = parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
  app.enableCors(allowedOrigins ? { origin: allowedOrigins } : undefined);
  // '.well-known/jwks.json' (Phase 2D.1) and '.well-known/openid-configuration'
  // (Phase 2D.8) must resolve at their standard, spec-required paths —
  // never under the versioned /api/v1 prefix, the same reason 'health' (and,
  // Phase 2D.11, its 'health/live'/'health/ready' siblings — an orchestrator
  // probing liveness/readiness should never need to know this API's own
  // version prefix) is excluded.
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/(.*)', '.well-known/jwks.json', '.well-known/openid-configuration'] });
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
