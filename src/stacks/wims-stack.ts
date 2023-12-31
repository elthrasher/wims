import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import {
  AttributeType,
  StreamViewType,
  TableV2,
} from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

import { TABLE_PK, TABLE_SK } from '../constants';
import { CDC } from '../constructs/cdc';
import { InventoryMonitor } from '../constructs/inventory-monitor';
import { ObservabilityConstruct } from '../constructs/observability';
import { OrdersApi } from '../constructs/orders-api';
import { OrdersProcessor } from '../constructs/orders-processor';
import { PaymentsApi } from '../constructs/payments-api';
import { PaymentsQueue } from '../constructs/payments-queue';

export class WimsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const table = new TableV2(this, 'WIMSTable', {
      dynamoStream: StreamViewType.NEW_AND_OLD_IMAGES,
      partitionKey: { name: TABLE_PK, type: AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
      sortKey: { name: TABLE_SK, type: AttributeType.STRING },
      tableName: 'WIMS',
    });

    new CDC(this, 'CDC', { table });
    new InventoryMonitor(this, 'InventoryMonitor');
    new ObservabilityConstruct(this, 'Observability');
    const paymentsApi = new PaymentsApi(this, 'PaymentsApi');
    const paymentsQueue = new PaymentsQueue(this, 'PaymentsQueue', {
      api: paymentsApi.getApi(),
    });
    const ordersApi = new OrdersApi(this, 'OrdersApi', { table });
    new OrdersProcessor(this, 'OrdersProcessor', {
      queue: paymentsQueue.getQueue(),
      table,
    });

    new CfnOutput(this, 'InventoryUrl', {
      value: ordersApi.getApi().deploymentStage.urlForPath('/inventory'),
    });
    new CfnOutput(this, 'OrdersUrl', {
      value: ordersApi.getApi().deploymentStage.urlForPath('/orders'),
    });
  }
}
