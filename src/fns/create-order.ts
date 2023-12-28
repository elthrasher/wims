import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const api = process.env.API_URL;
const table = process.env.TABLE_NAME;

if (!api || !table) {
  throw new Error('Missing required env var!');
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  if (!event.body) {
    throw new Error('Missing event body!');
  }

  const order = JSON.parse(event.body);

  if (!order.customerId || !order.quantity) {
    throw new Error('Invalid order!');
  }

  const timestamp = new Date().getTime();

  // First create the order
  const createOrderCommand = new PutCommand({
    Item: {
      ...order,
      status: 'PENDING',
      timestamp,
      pk: `CUSTOMER#${order.customerId}`,
      sk: `TIMESTAMP#${timestamp}`,
    },
    TableName: table,
  });
  await client.send(createOrderCommand);

  // Then update inventory
  const updateInventoryCommand = new UpdateCommand({
    ExpressionAttributeNames: { '#quantity': 'quantity' },
    ExpressionAttributeValues: { ':quantity': order.quantity },
    Key: { pk: 'INVENTORY#MACGUFFIN', sk: 'MODEL#LX' },
    TableName: table,
    UpdateExpression: 'set #quantity = #quantity - :quantity',
  });
  await client.send(updateInventoryCommand);

  // Now process payment
  await fetch(api, { body: order, method: 'POST' });

  return {
    body: 'Order created!',
    statusCode: 200,
  };
};
