import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import {
  AwsIntegration,
  MockIntegration,
  PassthroughBehavior,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { AttributeType, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { CfnPipe } from 'aws-cdk-lib/aws-pipes';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

import { TABLE_PK, TABLE_SK } from '../constants';

export class WimsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Payments is an external system so mocked here.
    const paymentsApi = new RestApi(this, 'WIMSPayments');
    const payments = paymentsApi.root.addResource('payments');
    payments.addMethod(
      'POST',
      new MockIntegration({
        integrationResponses: [
          {
            responseTemplates: {
              'application/json':
                '{"message": "Payment Success!", "statusCode": 200 }',
            },
            statusCode: '200',
          },
        ],
        passthroughBehavior: PassthroughBehavior.NEVER,
        requestTemplates: {
          'application/json': '{ "statusCode": 200 }',
        },
      }),
      { methodResponses: [{ statusCode: '200' }] }
    );

    const table = new TableV2(this, 'WIMSTable', {
      partitionKey: { name: TABLE_PK, type: AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
      sortKey: { name: TABLE_SK, type: AttributeType.STRING },
      tableName: 'WIMS',
    });

    const throttlePlan = paymentsApi.addUsagePlan('ThrottlePlan', {
      name: 'Throttle',
      throttle: { rateLimit: 5, burstLimit: 1 },
    });
    const key = paymentsApi.addApiKey('ThrottleKey');
    throttlePlan.addApiKey(key);

    const bus = EventBus.fromEventBusName(this, 'DefaultBus', 'default');

    const pipeRole = new Role(this, 'PipeRole', {
      assumedBy: new ServicePrincipal('pipes.amazonaws.com'),
    });

    bus.grantPutEventsTo(pipeRole);
    table.grantStreamRead(pipeRole);

    new CfnPipe(this, 'DDBStreamPipe', {
      roleArn: pipeRole.roleArn,
      source: table.tableStreamArn!,
      sourceParameters: {
        dynamoDbStreamParameters: { batchSize: 10, startingPosition: 'LATEST' },
        filterCriteria: {
          filters: [{ pattern: JSON.stringify({ eventName: ['INSERT'] }) }],
        },
      },
      target: bus.eventBusArn,
    });

    const ordersApi = new RestApi(this, 'WIMSOrders', {
      deployOptions: { tracingEnabled: true },
    });

    const role = new Role(this, 'APIGatewayIntegrationRole', {
      assumedBy: new ServicePrincipal('apigateway.amazonaws.com'),
    });

    table.grantReadWriteData(role);

    // We can get the current MacGuffin inventory with an API call.
    const inventory = ordersApi.root.addResource('inventory');
    inventory.addMethod(
      'GET',
      new AwsIntegration({
        action: 'GetItem',
        options: {
          credentialsRole: role,
          integrationResponses: [
            {
              responseTemplates: {
                'application/json': `#set($inv = $input.path("$.Item"))
                {
                  "model": "$inv.model.S",
                  "productName": "$inv.productName.S",
                  "quantity": $inv.quantity.N,
                }`,
              },
              statusCode: '200',
            },
          ],
          requestTemplates: {
            'application/json': JSON.stringify({
              Key: {
                pk: {
                  S: 'INVENTORY#MACGUFFIN',
                },
                sk: {
                  S: 'MODEL#LX',
                },
              },
              TableName: table.tableName,
            }),
          },
        },
        service: 'dynamodb',
      }),
      {
        methodResponses: [{ statusCode: '200' }],
      }
    );

    // We can create a new order with an API call.
    const orders = ordersApi.root.addResource('orders');
    orders.addMethod(
      'POST',
      new AwsIntegration({
        action: 'PutItem',
        options: {
          credentialsRole: role,
          integrationResponses: [
            {
              responseTemplates: {
                'application/json': JSON.stringify({
                  message: 'Order created!',
                }),
              },
              statusCode: '200',
            },
          ],
          requestTemplates: {
            'application/json': JSON.stringify({
              Item: {
                pk: {
                  S: "$input.path('$.customerId')",
                },
                sk: {
                  S: '$context.requestTimeEpoch',
                },
                customerId: {
                  S: "$input.path('$.customerId')",
                },
                quantity: {
                  N: "$input.path('$.quantity')",
                },
              },
              TableName: table.tableName,
            }),
          },
        },
        service: 'dynamodb',
      }),
      {
        methodResponses: [{ statusCode: '200' }],
      }
    );

    // Seeder to add some inventory to our table:
    new AwsCustomResource(this, 'DBSeeder', {
      onCreate: {
        action: 'putItem',
        parameters: {
          Item: {
            [TABLE_PK]: { S: 'INVENTORY#MACGUFFIN' },
            [TABLE_SK]: { S: 'MODEL#LX' },
            model: { S: 'LX' },
            productName: { S: 'MacGuffin' },
            quantity: { N: '1000000' },
          },
          TableName: table.tableName,
        },
        physicalResourceId: PhysicalResourceId.fromResponse(''),
        service: 'DynamoDB',
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: [table.tableArn],
      }),
    });
  }
}
