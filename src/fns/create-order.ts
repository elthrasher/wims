import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { TABLE_PK, TABLE_SK } from '../constants';

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
      [TABLE_PK]: `CUSTOMER#${order.customerId}`,
      [TABLE_SK]: `TIMESTAMP#${timestamp}`,
    },
    TableName: table,
  });
  await client.send(createOrderCommand);

  // Then update inventory
  const updateInventoryCommand = new UpdateCommand({
    ExpressionAttributeNames: { '#quantity': 'quantity' },
    ExpressionAttributeValues: { ':quantity': order.quantity },
    Key: { [TABLE_PK]: 'INVENTORY#MACGUFFIN', [TABLE_SK]: 'MODEL#LX' },
    TableName: table,
    UpdateExpression: 'set #quantity = #quantity - :quantity',
  });
  await client.send(updateInventoryCommand);

  // Now process payment
  const result = await fetch(api, {
    body: JSON.stringify(order),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

  if (result.ok) {
    return {
      body: 'Order created!',
      statusCode: 200,
    };
  } else {
    return {
      body: 'An error has occurred!',
      statusCode: result.status,
    };
  }
};
