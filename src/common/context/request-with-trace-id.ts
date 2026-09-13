import { Request } from 'express';

/** Phase 1 extracted source — copied from TravelOS, classified REUSABLE. */
export interface RequestWithTraceId extends Request {
  traceId?: string;
}
