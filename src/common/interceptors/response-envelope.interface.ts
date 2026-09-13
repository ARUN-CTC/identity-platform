export interface ResponseEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
  errors: string[];
  traceId: string;
  timestamp: string;
}
