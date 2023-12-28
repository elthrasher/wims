import { unmarshall } from '@aws-sdk/util-dynamodb';

import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { DynamoDBRecord } from 'aws-lambda';

export const handler = async (records: DynamoDBRecord[]) => {
  return records.map((r) => {
    const oldImage = r.dynamodb?.OldImage
      ? unmarshall(r.dynamodb?.OldImage as Record<string, AttributeValue>)
      : undefined;
    const newImage = r.dynamodb?.NewImage
      ? unmarshall(r.dynamodb?.NewImage as Record<string, AttributeValue>)
      : undefined;
    const result: { dynamodb: Record<string, unknown>; eventName?: string } = {
      dynamodb: {},
      eventName: r.eventName,
    };
    if (newImage) result.dynamodb.NewImage = newImage;
    if (oldImage) result.dynamodb.OldImage = oldImage;
    return result;
  });
};
