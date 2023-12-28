import { Arn, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import {
  AwsIntegration,
  MockIntegration,
  PassthroughBehavior,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import {
  AttributeType,
  StreamViewType,
  TableV2,
} from 'aws-cdk-lib/aws-dynamodb';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { SfnStateMachine } from 'aws-cdk-lib/aws-events-targets';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { CfnPipe } from 'aws-cdk-lib/aws-pipes';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import {
  DefinitionBody,
  JsonPath,
  LogLevel,
  Parallel,
  StateMachine,
  StateMachineType,
  TaskInput,
} from 'aws-cdk-lib/aws-stepfunctions';
import {
  DynamoAttributeValue,
  DynamoUpdateItem,
  SqsSendMessage,
} from 'aws-cdk-lib/aws-stepfunctions-tasks';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { PROJECT_SOURCE, TABLE_PK, TABLE_SK } from '../constants';
import { ObservabilityConstruct } from '../constructs/observability';

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

    const throttlePlan = paymentsApi.addUsagePlan('ThrottlePlan', {
      name: 'Throttle',
      throttle: { rateLimit: 5, burstLimit: 1 },
    });
    const key = paymentsApi.addApiKey('ThrottleKey');
    throttlePlan.addApiKey(key);
    const paymentsQueue = new Queue(this, 'PaymentsQueue', {
      queueName: 'payments-queue',
    });

    const table = new TableV2(this, 'WIMSTable', {
      dynamoStream: StreamViewType.NEW_AND_OLD_IMAGES,
      partitionKey: { name: TABLE_PK, type: AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
      sortKey: { name: TABLE_SK, type: AttributeType.STRING },
      tableName: 'WIMS',
    });

    const cdcEnrichmentFn = new NodejsFunction(this, 'CDCEnrichment', {
      entry: './src/fns/cdc-enrichment.ts',
      functionName: 'cdc-enrichment',
      logRetention: RetentionDays.ONE_WEEK,
      runtime: Runtime.NODEJS_20_X,
    });

    const parallel = new Parallel(this, 'Parallel Steps');

    const adjustInventory = new DynamoUpdateItem(this, 'AdjustInventory', {
      expressionAttributeNames: { '#quantity': 'quantity' },
      expressionAttributeValues: {
        ':quantity': DynamoAttributeValue.numberFromString(
          JsonPath.format(
            '{}',
            JsonPath.stringAt('$.detail.dynamodb.NewImage.quantity')
          )
        ),
      },
      conditionExpression: '#quantity >= :quantity',
      key: {
        [TABLE_PK]: DynamoAttributeValue.fromString('INVENTORY#MACGUFFIN'),
        [TABLE_SK]: DynamoAttributeValue.fromString('MODEL#LX'),
      },
      resultPath: JsonPath.DISCARD,
      table,
      updateExpression: 'set #quantity = #quantity - :quantity',
    });

    const enqueuePayment = new SqsSendMessage(this, 'EnqueuePayment', {
      messageBody: TaskInput.fromJsonPathAt('$.detail.dynamodb.NewImage'),
      queue: paymentsQueue,
    });

    parallel.branch(adjustInventory);
    parallel.branch(enqueuePayment);

    const sm = new StateMachine(this, 'OrdersStateMachine', {
      definitionBody: DefinitionBody.fromChainable(parallel),
      logs: {
        destination: new LogGroup(this, 'SMLogs', {
          logGroupName: '/FreeCodeCamp/OrdersSMLogs',
          retention: RetentionDays.ONE_DAY,
        }),
        includeExecutionData: true,
        level: LogLevel.ALL,
      },
      stateMachineName: 'orders-state-machine',
      stateMachineType: StateMachineType.EXPRESS,
      tracingEnabled: true,
    });

    const bus = EventBus.fromEventBusName(this, 'DefaultBus', 'default');

    const streamPipeRole = new Role(this, 'StreamPipeRole', {
      assumedBy: new ServicePrincipal('pipes.amazonaws.com'),
    });

    const streamPipeLogs = new LogGroup(this, 'StreamPipeLogs', {
      logGroupName: '/FreeCodeCamp/streamPipeLogs',
      retention: RetentionDays.ONE_DAY,
    });

    const paymentsPipeRole = new Role(this, 'PaymentsPipeRole', {
      assumedBy: new ServicePrincipal('pipes.amazonaws.com'),
    });

    const paymentsPipeLogs = new LogGroup(this, 'PaymentsPipeLogs', {
      logGroupName: '/FreeCodeCamp/paymentsPipeLogs',
      retention: RetentionDays.ONE_DAY,
    });

    bus.grantPutEventsTo(streamPipeRole);
    cdcEnrichmentFn.grantInvoke(streamPipeRole);
    table.grantStreamRead(streamPipeRole);
    paymentsQueue.grantConsumeMessages(paymentsPipeRole);

    const cdcEvent = 'cdcEvent';
    new Rule(this, 'OrderStateMachineRule', {
      eventBus: bus,
      eventPattern: {
        source: [PROJECT_SOURCE],
        detailType: [cdcEvent],
        detail: {
          eventType: ['INSERT'],
          pk: ['CUSTOMER#*'],
        },
      },
      ruleName: 'OrdersStateMachine',
      targets: [new SfnStateMachine(sm)],
    });

    new CfnPipe(this, 'DDBStreamPipe', {
      enrichment: cdcEnrichmentFn.functionArn,
      logConfiguration: {
        cloudwatchLogsLogDestination: {
          logGroupArn: streamPipeLogs.logGroupArn,
        },
        includeExecutionData: ['ALL'],
        level: 'INFO',
      },
      name: 'DDBStreamPipe',
      roleArn: streamPipeRole.roleArn,
      source: table.tableStreamArn!,
      sourceParameters: {
        dynamoDbStreamParameters: { batchSize: 10, startingPosition: 'LATEST' },
        filterCriteria: {
          filters: [{ pattern: JSON.stringify({ eventName: ['INSERT'] }) }],
        },
      },
      target: bus.eventBusArn,
      targetParameters: {
        eventBridgeEventBusParameters: {
          source: PROJECT_SOURCE,
          detailType: cdcEvent,
        },
      },
    });

    new CfnPipe(this, 'PaymentsPipe', {
      logConfiguration: {
        cloudwatchLogsLogDestination: {
          logGroupArn: paymentsPipeLogs.logGroupArn,
        },
        includeExecutionData: ['ALL'],
        level: 'INFO',
      },
      name: 'PaymentsPipe',
      roleArn: paymentsPipeRole.roleArn,
      source: paymentsQueue.queueArn,
      target: Arn.format(
        {
          service: 'execute-api',
          resource: `${paymentsApi.restApiId}/prod/POST/payments`,
        },
        Stack.of(this)
      ),
      targetParameters: {
        eventBridgeEventBusParameters: {
          source: PROJECT_SOURCE,
        },
        inputTemplate: `{
          "body": <$.body>
        }`,
      },
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
                [TABLE_PK]: {
                  S: 'INVENTORY#MACGUFFIN',
                },
                [TABLE_SK]: {
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
                [TABLE_PK]: {
                  S: "CUSTOMER#$input.path('$.customerId')",
                },
                [TABLE_SK]: {
                  S: 'TIMESTAMP#$context.requestTimeEpoch',
                },
                customerId: {
                  S: "$input.path('$.customerId')",
                },
                quantity: {
                  N: "$input.path('$.quantity')",
                },
                status: {
                  S: 'PENDING',
                },
                timestamp: {
                  N: '$context.requestTimeEpoch',
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

    new ObservabilityConstruct(this, 'Observability');
  }
}
