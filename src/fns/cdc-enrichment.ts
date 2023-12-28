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
    const result: { pk: string; sk: string; dynamodb: Record<string, unknown>; eventName?: string; eventType: string; } = {
      pk: oldImage?.[TABLE_PK] || newImage?.[TABLE_PK] || '',
      sk: oldImage?.[TABLE_SK] || newImage?.[TABLE_SK] || '',
      dynamodb: {},
      eventName: r.eventName,
      eventType: oldImage && newImage ? 'UPDATE' : oldImage ? 'REMOVE' : 'INSERT',
    };
    if (newImage) result.dynamodb.NewImage = newImage;
    if (oldImage) result.dynamodb.OldImage = oldImage;
    return result;
  });
};
