import { SetMetadata } from '@nestjs/common';

export const EXPECTED_AUDIENCE_KEY = 'expected_audience';

/**
 * Phase 2D.5 — declares which resource-API audience a route protected by
 * `ExternalBearerAuthGuard` requires, read by that guard via `Reflector`
 * (the same `SetMetadata`+`Reflector` idiom `@RequirePlatformPermissions`/
 * `PlatformPermissionsGuard` already establish). Mandatory: a route using
 * the guard without this decorator is a configuration error the guard
 * itself refuses to silently default around (brief §11: audience
 * validation is mandatory, never optional-with-a-fallback).
 */
export const ExpectedAudience = (audience: string) => SetMetadata(EXPECTED_AUDIENCE_KEY, audience);
