import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import {
  LambdaIntegration,
  MockIntegration,
  PassthroughBehavior,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { AttributeType, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
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

    const getInventoryFn = new NodejsFunction(this, 'GetInventory', {
      entry: './src/fns/get-inventory.ts',
      environment: { TABLE_NAME: table.tableName },
      functionName: 'get-inventory',
      logRetention: RetentionDays.ONE_WEEK,
      runtime: Runtime.NODEJS_20_X,
    });
    table.grantReadData(getInventoryFn);

    const createOrderFn = new NodejsFunction(this, 'CreateOrder', {
      entry: './src/fns/create-order.ts',
      environment: {
        API_URL: paymentsApi.deploymentStage.urlForPath('/payments'),
        TABLE_NAME: table.tableName,
      },
      functionName: 'create-order',
      logRetention: RetentionDays.ONE_WEEK,
      runtime: Runtime.NODEJS_20_X,
    });
    table.grantWriteData(createOrderFn);

    const ordersApi = new RestApi(this, 'WIMSOrders');

    // We can get the current MacGuffin inventory with an API call.
    const inventory = ordersApi.root.addResource('inventory');
    inventory.addMethod('GET', new LambdaIntegration(getInventoryFn));

    // We can create a new order with an API call.
    const orders = ordersApi.root.addResource('orders');
    orders.addMethod('POST', new LambdaIntegration(createOrderFn));

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
