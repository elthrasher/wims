import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyResult } from 'aws-lambda';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const table = process.env.TABLE_NAME;

if (!table) {
  throw new Error('Missing required env var!');
}

export const handler = async (): Promise<APIGatewayProxyResult> => {
  const command = new GetCommand({
    Key: { pk: 'INVENTORY#MACGUFFIN', sk: 'MODEL#LX' },
    TableName: table,
  });
  const result = await client.send(command);

  if (result.Item) {
    return {
      body: JSON.stringify(result.Item),
      statusCode: 200,
    };
  }

  return {
    body: 'MacGuffin Not Found!',
    statusCode: 404,
  };
};
