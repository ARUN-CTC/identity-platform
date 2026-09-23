// Load env vars before anything (AppModule -> @prisma/client) is imported.
import 'dotenv/config';
import './common/bigint-json.polyfill';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
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
  // Phase 2UI.5A (docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md) — required to
  // populate req.cookies for OAuthBrowserSessionGuard. No other guard/route
  // reads a cookie; every other endpoint remains exactly as it was
  // (Authorization: Bearer only).
  app.use(cookieParser());
  // Phase 2D.11 (docs/PRODUCTION_READINESS.md §Configuration) — previously
  // `app.enableCors()` with no options at all, meaning EVERY origin was
  // reflected and allowed unconditionally, in every environment including
  // production. `CORS_ALLOWED_ORIGINS` (comma-separated) now gates this:
  // unset means "reflect the request's own origin" (`origin: true` — the
  // `cors` package's own reflection mode, harmless in local development and
  // the previous, unchanged default behavior for it — NOT a literal `*`,
  // which credentialed requests cannot use at all per the CORS spec), but
  // `validateProductionConfig` (Phase 2D.9/2D.11) refuses to boot in
  // production without it explicitly set.
  //
  // `credentials: true` is new as of Phase 2UI.5A: this app now sets ONE
  // cookie (`identity_browser_session`, HttpOnly/Secure/SameSite=Lax,
  // path-scoped to /api/v1/oauth — see OAUTH_BROWSER_SESSION_ARCHITECTURE.md)
  // so it can be honored when the SPA's own login/refresh fetch() calls are
  // cross-origin (dev: different ports; prod: possibly different
  // subdomains) — `credentials: true` is what lets the browser actually
  // store a cross-origin Set-Cookie response and, symmetrically, attach it
  // back on a later cross-origin fetch. This does NOT reopen the CSRF-free
  // invariant the previous comment here described: every state-changing
  // endpoint (login, logout, refresh, organization switch) remains
  // Bearer-header-only and structurally CSRF-immune regardless of what
  // cookies the browser happens to send — see that document's own §15 for
  // the full justification. The cookie itself is read by exactly one guard,
  // on exactly two GET routes, neither of which is state-changing beyond
  // what the underlying, unchanged AuthorizeService already permits.
  const allowedOrigins = parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
  app.enableCors({ origin: allowedOrigins ?? true, credentials: true });
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
