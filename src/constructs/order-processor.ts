import { RemovalPolicy } from 'aws-cdk-lib';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { SfnStateMachine } from 'aws-cdk-lib/aws-events-targets';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
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
import { Construct } from 'constructs';

import { CDC_EVENT, PROJECT_SOURCE, TABLE_PK, TABLE_SK } from '../constants';

interface OrderProcessorProps {
  queue: Queue;
  table: TableV2;
}

export class OrderProcessor extends Construct {
  constructor(scope: Construct, id: string, props: OrderProcessorProps) {
    super(scope, id);

    const { queue, table } = props;

    const bus = EventBus.fromEventBusName(this, 'DefaultBus', 'default');

    const parallel = new Parallel(this, 'Parallel Steps');

    const adjustInventory = new DynamoUpdateItem(this, 'AdjustInventory', {
      expressionAttributeNames: { '#quantity': 'quantity' },
      expressionAttributeValues: {
        ':quantity': DynamoAttributeValue.numberFromString(
          JsonPath.format(
            '{}',
            JsonPath.stringAt('$.detail.data.NewImage.quantity')
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
      messageBody: TaskInput.fromJsonPathAt('$.detail.data.NewImage'),
      queue,
    });

    parallel.branch(adjustInventory);
    parallel.branch(enqueuePayment);

    const sm = new StateMachine(this, 'OrdersStateMachine', {
      definitionBody: DefinitionBody.fromChainable(parallel),
      logs: {
        destination: new LogGroup(this, 'SMLogs', {
          logGroupName: '/aws/vendedlogs/states/OrdersSMLogs',
          removalPolicy: RemovalPolicy.DESTROY,
          retention: RetentionDays.ONE_DAY,
        }),
        includeExecutionData: true,
        level: LogLevel.ALL,
      },
      stateMachineName: 'orders-state-machine',
      stateMachineType: StateMachineType.EXPRESS,
      tracingEnabled: true,
    });

    new Rule(this, 'OrderStateMachineRule', {
      eventBus: bus,
      eventPattern: {
        source: [PROJECT_SOURCE],
        detailType: [CDC_EVENT],
        detail: {
          data: {
            eventType: ['INSERT'],
            pk: [{ prefix: 'CUSTOMER#' }],
          },
        },
      },
      ruleName: 'OrdersStateMachine',
      targets: [new SfnStateMachine(sm)],
    });
  }
}
