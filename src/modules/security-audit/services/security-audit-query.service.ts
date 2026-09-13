import { Injectable } from '@nestjs/common';
import { PaginatedResult } from '../../../common';
import { SecurityAuditRepository } from '../repositories/security-audit.repository';
import { LoginAttemptQueryDto } from '../dto/login-attempt-query.dto';
import { SecurityEventQueryDto } from '../dto/security-event-query.dto';

@Injectable()
export class SecurityAuditQueryService {
  constructor(private readonly repository: SecurityAuditRepository) {}

  async listLoginAttempts(query: LoginAttemptQueryDto) {
    const { items, total } = await this.repository.findLoginAttempts(query);
    return new PaginatedResult(items, total, query);
  }

  async listEvents(query: SecurityEventQueryDto) {
    const { items, total } = await this.repository.findEvents(query);
    return new PaginatedResult(items, total, query);
  }
}
