import { unmarshall } from '@aws-sdk/util-dynamodb';

import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { DynamoDBRecord } from 'aws-lambda';
import { TABLE_PK, TABLE_SK } from '../constants';

export const handler = async (records: DynamoDBRecord[]) => {
  return records.map((r) => {
    const oldImage = r.dynamodb?.OldImage
      ? unmarshall(r.dynamodb?.OldImage as Record<string, AttributeValue>)
      : undefined;
    const newImage = r.dynamodb?.NewImage
      ? unmarshall(r.dynamodb?.NewImage as Record<string, AttributeValue>)
      : undefined;
    const result: {
      meta: Record<string, string>;
      data: {
        pk: string;
        sk: string;
        eventName: string;
        eventType: string;
        NewImage?: Record<string, unknown>;
        OldImage?: Record<string, unknown>;
      };
    } = {
      meta: {
        fn: process.env.AWS_LAMBDA_FUNCTION_NAME!,
      },
      data: {
        pk: oldImage?.[TABLE_PK] || newImage?.[TABLE_PK],
        sk: oldImage?.[TABLE_SK] || newImage?.[TABLE_SK],
        eventName: r.eventName || 'UNKNOWN',
        eventType:
          oldImage && newImage ? 'UPDATE' : oldImage ? 'REMOVE' : 'INSERT',
      },
    };
    if (newImage) result.data.NewImage = newImage;
    if (oldImage) result.data.OldImage = oldImage;
    return result;
  });
};
