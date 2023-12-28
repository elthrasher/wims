import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import {
  AwsIntegration,
  MockIntegration,
  PassthroughBehavior,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import {
  AttributeType,
  BillingMode,
  StreamViewType,
  Table,
} from 'aws-cdk-lib/aws-dynamodb';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { SfnStateMachine } from 'aws-cdk-lib/aws-events-targets';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { CfnPipe } from 'aws-cdk-lib/aws-pipes';
import {
  DefinitionBody,
  JsonPath,
  Parallel,
  StateMachine,
  TaskInput,
} from 'aws-cdk-lib/aws-stepfunctions';
import {
  CallApiGatewayRestApiEndpoint,
  DynamoAttributeValue,
  DynamoUpdateItem,
  HttpMethod,
} from 'aws-cdk-lib/aws-stepfunctions-tasks';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

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

    const table = new Table(this, 'WIMSTable', {
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
      sortKey: { name: 'sk', type: AttributeType.STRING },
      stream: StreamViewType.NEW_IMAGE,
      tableName: 'WIMS',
    });

    const adjustInventory = new DynamoUpdateItem(this, 'AdjustInventory', {
      expressionAttributeNames: { '#quantity': 'quantity' },
      expressionAttributeValues: {
        ':quantity': DynamoAttributeValue.numberFromString(
          JsonPath.stringAt('$.detail.quantity')
        ),
      },
      conditionExpression: '#quantity >= :quantity',
      key: {
        pk: DynamoAttributeValue.fromString('INVENTORY#MACGUFFIN'),
        sk: DynamoAttributeValue.fromString('MODEL#LX'),
      },
      resultPath: JsonPath.DISCARD,
      table,
      updateExpression: 'set #quantity = #quantity - :quantity',
    });

    const callPaymentsApi = new CallApiGatewayRestApiEndpoint(
      this,
      'CallPaymentsApi',
      {
        api: paymentsApi,
        apiPath: '/payments',
        method: HttpMethod.POST,
        requestBody: TaskInput.fromJsonPathAt('$.detail'),
        stageName: 'prod',
      }
    );

    const sm = new StateMachine(this, 'OrdersStateMachine', {
      definitionBody: DefinitionBody.fromChainable(
        adjustInventory.next(callPaymentsApi)
      ),
      stateMachineName: 'orders-state-machine',
      tracingEnabled: true,
    });

    const bus = EventBus.fromEventBusName(this, 'DefaultBus', 'default');

    const pipeRole = new Role(this, 'PipeRole', {
      assumedBy: new ServicePrincipal('pipes.amazonaws.com'),
    });

    bus.grantPutEventsTo(pipeRole);
    table.grantStreamRead(pipeRole);

    new Rule(this, 'OrderStateMachineRule', {
      eventBus: bus,
      eventPattern: { source: ['Pipe DDBStreamPipe'] },
      ruleName: 'OrdersStateMachine',
      targets: [new SfnStateMachine(sm)],
    });

    new CfnPipe(this, 'DDBStreamPipe', {
      name: 'DDBStreamPipe',
      roleArn: pipeRole.roleArn,
      source: table.tableStreamArn!,
      sourceParameters: {
        dynamoDbStreamParameters: { batchSize: 10, startingPosition: 'LATEST' },
        filterCriteria: {
          filters: [{ pattern: JSON.stringify({ eventName: ['INSERT'] }) }],
        },
      },
      target: bus.eventBusArn,
      targetParameters: {
        inputTemplate: `{
          "customerId": <$.dynamodb.NewImage.customerId.S>, 
          "quantity": <$.dynamodb.NewImage.quantity.N>, 
          "status": <$.dynamodb.NewImage.status.S>,
          "timestamp": <$.dynamodb.NewImage.timestamp.N> 
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
                  S: "CUSTOMER#$input.path('$.customerId')",
                },
                sk: {
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
            pk: { S: 'INVENTORY#MACGUFFIN' },
            sk: { S: 'MODEL#LX' },
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
