import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common';
import { PrismaService } from '../../../database';

/**
 * Phase 2D.11 (docs/PRODUCTION_READINESS.md §Health/Readiness) — splits the
 * single, DB-coupled `GET /health` (Phase 1, unchanged below for backward
 * compatibility with `tests/health.e2e-spec.ts` and any existing external
 * monitor already polling it) into a genuine liveness/readiness pair, per
 * the standard Kubernetes-style contract:
 *
 *   - Liveness ("is the process alive?") must NEVER depend on an external
 *     dependency (brief §20) — a slow/unreachable database must never cause
 *     an orchestrator to conclude the PROCESS itself is dead and restart it
 *     (restarting does not fix a database outage, and a restart storm during
 *     one only adds load). `/health/live` does no I/O at all.
 *   - Readiness ("can this instance safely serve requests?") DOES depend on
 *     the database (this platform's only hard runtime dependency) — a
 *     load balancer / orchestrator should stop routing new traffic to an
 *     instance that cannot reach it, without killing the process.
 *     `/health/ready` returns 503 (not 200-with-a-degraded-body) so a
 *     standard readiness probe's default "non-2xx = not ready" check works
 *     with no special-cased body parsing.
 *
 * Neither endpoint exposes anything beyond up/down — no connection string,
 * no pool statistics, no internal error message (brief §20: "do not expose
 * sensitive dependency information publicly").
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Original Phase 1 endpoint — unchanged response shape, kept for backward compatibility. Couples liveness and readiness; prefer /health/live + /health/ready for new integrations (see this class's own doc comment). */
  @Get()
  @Public()
  @ApiOperation({ summary: '[legacy, combined] Process + database status — prefer /health/live and /health/ready for new integrations' })
  async check() {
    const database = await this.probeDatabase();
    return { status: database === 'up' ? 'ok' : 'degraded', database, timestamp: new Date().toISOString() };
  }

  @Get('live')
  @Public()
  @ApiOperation({ summary: 'Liveness — is the process itself alive? No I/O, no dependency check.' })
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @Public()
  @ApiOperation({ summary: 'Readiness — can this instance safely serve requests right now? 503 if the database is unreachable.' })
  async ready() {
    const database = await this.probeDatabase();
    if (database !== 'up') {
      throw new ServiceUnavailableException({ status: 'not_ready', database, timestamp: new Date().toISOString() });
    }
    return { status: 'ready', database, timestamp: new Date().toISOString() };
  }

  private async probeDatabase(): Promise<'up' | 'down'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }
}
