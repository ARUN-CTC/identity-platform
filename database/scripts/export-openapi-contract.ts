/**
 * Phase 2D.12 (docs/API_SECURITY_CONTRACT_FREEZE.md) — generates the ONE
 * authoritative HTTP API contract artifact (`docs/contracts/identity-api-v1.json`)
 * directly from the real, running application's own route/DTO metadata
 * (the same `SwaggerModule.createDocument` call `src/main.ts` already
 * makes for `/api/docs`) — never a hand-written, independently-maintained
 * copy that could silently drift from the actual implementation.
 *
 * Run: `npx ts-node database/scripts/export-openapi-contract.ts`
 * (or `npm run contracts:export`, Phase 2D.12).
 */
import 'dotenv/config';
import '../../src/common/bigint-json.polyfill';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../../src/app.module';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Identity Platform API')
    .setDescription(
      'Modular, product-agnostic IAM platform: tenants, organizations, users, roles/permissions (RBAC), ' +
        'sessions, authentication, OAuth 2.1/OIDC, and security audit. Phase 2D.12 contract freeze — see ' +
        'docs/API_SECURITY_CONTRACT_FREEZE.md.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);

  const outPath = join(__dirname, '..', '..', 'docs', 'contracts', 'identity-api-v1.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n', 'utf-8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPath}`);

  await app.close();
  process.exit(0);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to export OpenAPI contract:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
