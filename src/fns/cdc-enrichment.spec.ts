import { describe, expect, test } from 'vitest';

import { handler } from './cdc-enrichment';

const createRecord = {
  pk: {
    S: 'CUSTOMER#349',
  },
  sk: {
    S: 'TIMESTAMP#1703887841412',
  },
  customerId: {
    S: '349',
  },
  quantity: {
    N: '7',
  },
  status: {
    S: 'PENDING',
  },
  timestamp: {
    N: '1703887841412',
  },
};

const beforeAdjustment = {
  pk: {
    S: 'INVENTORY#MACGUFFIN',
  },
  sk: {
    S: 'MODEL#LX',
  },
  model: {
    S: 'LX',
  },
  productName: {
    S: 'MacGuffin',
  },
  quantity: {
    N: '977580',
  },
};

const afterAdjustment = {
  pk: {
    S: 'INVENTORY#MACGUFFIN',
  },
  sk: {
    S: 'MODEL#LX',
  },
  model: {
    S: 'LX',
  },
  productName: {
    S: 'MacGuffin',
  },
  quantity: {
    N: '977570',
  },
};

describe('create an order', () => {
  test('should return the JSON version of a dynamodb record with additional metadata', async () => {
    const response = await handler([
      {
        dynamodb: {
          NewImage: createRecord,
        },
      },
    ]);
    expect(response).toStrictEqual([
      {
        data: {
          NewImage: {
            customerId: '349',
            pk: 'CUSTOMER#349',
            quantity: 7,
            sk: 'TIMESTAMP#1703887841412',
            status: 'PENDING',
            timestamp: 1703887841412,
          },
          eventName: 'UNKNOWN',
          eventType: 'INSERT',
          pk: 'CUSTOMER#349',
          sk: 'TIMESTAMP#1703887841412',
        },
        meta: {
          fn: 'cdc-enrichment',
        },
      },
    ]);
  });
});

describe('adjust inventory', () => {
  test('should return the JSON version of a dynamodb record with additional metadata', async () => {
    const response = await handler([
      {
        dynamodb: {
          OldImage: beforeAdjustment,
          NewImage: afterAdjustment,
        },
      },
    ]);
    expect(response).toStrictEqual([
      {
        data: {
          NewImage: {
            model: 'LX',
            pk: 'INVENTORY#MACGUFFIN',
            productName: 'MacGuffin',
            quantity: 977570,
            sk: 'MODEL#LX',
          },
          OldImage: {
            model: 'LX',
            pk: 'INVENTORY#MACGUFFIN',
            productName: 'MacGuffin',
            quantity: 977580,
            sk: 'MODEL#LX',
          },
          eventName: 'UNKNOWN',
          eventType: 'UPDATE',
          pk: 'INVENTORY#MACGUFFIN',
          sk: 'MODEL#LX',
        },
        meta: {
          fn: 'cdc-enrichment',
        },
      },
    ]);
  });
});

describe('no input', () => {
  test('should return an empty array', async () => {
    const response = await handler([]);
    expect(response).toStrictEqual([]);
  });
});

describe('(hypothetical) delete', () => {
  test('should return the JSON version of a dynamodb record with additional metadata', async () => {
    const response = await handler([
      {
        dynamodb: {
          OldImage: createRecord,
        },
      },
    ]);
    expect(response).toStrictEqual([
      {
        data: {
          OldImage: {
            customerId: '349',
            pk: 'CUSTOMER#349',
            quantity: 7,
            sk: 'TIMESTAMP#1703887841412',
            status: 'PENDING',
            timestamp: 1703887841412,
          },
          eventName: 'UNKNOWN',
          eventType: 'REMOVE',
          pk: 'CUSTOMER#349',
          sk: 'TIMESTAMP#1703887841412',
        },
        meta: {
          fn: 'cdc-enrichment',
        },
      },
    ]);
  });
});
