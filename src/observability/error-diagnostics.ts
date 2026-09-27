export function errorDiagnostics(error: unknown): {
  errorType: string;
  errorCode?: string;
} {
  if (!(error instanceof Error)) return { errorType: 'UnknownError' };
  const code =
    'code' in error && typeof error.code === 'string' ? error.code : undefined;
  return {
    errorType: error.name || 'Error',
    ...(code ? { errorCode: code } : {}),
  };
}
