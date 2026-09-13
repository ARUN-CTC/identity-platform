import { BadRequestException, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from './app-cls-store';

/**
 * Phase 1 extracted source — copied from TravelOS
 * (apps/backend/src/common/context/request-context.service.ts), classified
 * REUSABLE. This is the generic backend of the multi-tenancy model: every
 * repository reads the caller's tenantId from here, never from a client
 * header/body field directly.
 */
@Injectable()
export class RequestContextService {
  constructor(private readonly cls: ClsService<AppClsStore>) {}

  get tenantId(): string | undefined {
    return this.cls.get('tenantId');
  }

  requireTenantId(): string {
    const tenantId = this.tenantId;
    if (!tenantId) {
      throw new BadRequestException('No tenant context on this request');
    }
    return tenantId;
  }

  get userId(): string | undefined {
    return this.cls.get('userId');
  }

  get sessionId(): string | undefined {
    return this.cls.get('sessionId');
  }

  get traceId(): string {
    return this.cls.get('traceId');
  }

  setTenantId(tenantId: string | undefined): void {
    this.cls.set('tenantId', tenantId);
  }

  setUserId(userId: string | undefined): void {
    this.cls.set('userId', userId);
  }

  setSessionId(sessionId: string | undefined): void {
    this.cls.set('sessionId', sessionId);
  }

  setTraceId(traceId: string): void {
    this.cls.set('traceId', traceId);
  }
}
