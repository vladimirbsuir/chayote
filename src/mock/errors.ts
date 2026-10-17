export class MockBackendError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MockBackendError';
    this.code = code;
  }
}

export function notFound(): MockBackendError {
  return new MockBackendError('NOT_FOUND', 'That item no longer exists.');
}

export function cycleDetected(): MockBackendError {
  return new MockBackendError('CYCLE_DETECTED', 'A folder cannot be moved inside itself.');
}

export function validation(message: string): MockBackendError {
  return new MockBackendError('VALIDATION', message);
}

/** ADR-024. The message is `AppError::Network`'s, verbatim, so the pane's
    `NETWORK` branch is exercised against the same sentence a device sends —
    `mockBackend` errors are `Error` instances where a real `invoke` rejection is
    a bare wire object, and the tab's handling has to work for both. */
export function unreachable(): MockBackendError {
  return new MockBackendError('NETWORK', 'Could not reach the sync server.');
}

export function docInvalid(): MockBackendError {
  return new MockBackendError('DOC_INVALID', 'This note could not be opened.');
}
