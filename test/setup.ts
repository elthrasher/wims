import { expect, vi } from 'vitest';

vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'cdc-enrichment');

expect.addSnapshotSerializer({
  serialize: (val) => JSON.stringify({ ...val, S3Key: '[HASH REMOVED].zip' }),
  test: (val) => val && Object.prototype.hasOwnProperty.call(val, 'S3Key'),
});
