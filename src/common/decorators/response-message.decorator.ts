import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE_KEY = 'response_message';

/**
 * Declares the `message` field of the standard response envelope for this
 * route (see ResponseInterceptor). Phase 1 extracted source — copied from
 * TravelOS, classified REUSABLE.
 *
 * @example @ResponseMessage('Tenant created successfully')
 */
export const ResponseMessage = (message: string) => SetMetadata(RESPONSE_MESSAGE_KEY, message);
