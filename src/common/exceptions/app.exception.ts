import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base for domain-level errors carrying a stable machine-readable `code`
 * in the response envelope's errors[]. Phase 1 extracted source — copied
 * from TravelOS, classified REUSABLE.
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(message, status);
  }
}

export class ResourceNotFoundException extends AppException {
  constructor(resource: string, identifier: string) {
    super(
      `${resource.toUpperCase()}_NOT_FOUND`,
      `${resource} '${identifier}' not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}

export class ResourceConflictException extends AppException {
  constructor(resource: string, message: string) {
    super(`${resource.toUpperCase()}_CONFLICT`, message, HttpStatus.CONFLICT);
  }
}
