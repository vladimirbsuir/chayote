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

export function docInvalid(): MockBackendError {
  return new MockBackendError('DOC_INVALID', 'This note could not be opened.');
}
