import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { SnsTopic } from 'aws-cdk-lib/aws-events-targets';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

import { CDC_EVENT, PROJECT_SOURCE } from '../constants';

export class InventoryMonitor extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const bus = EventBus.fromEventBusName(this, 'DefaultBus', 'default');

    const inventoryStockTopic = new Topic(this, 'InventoryStockTopic');
    inventoryStockTopic.addSubscription(new EmailSubscription('m@martz.codes'));

    new Rule(this, 'InventoryStockRule', {
      eventBus: bus,
      eventPattern: {
        source: [PROJECT_SOURCE],
        detailType: [CDC_EVENT],
        detail: {
          data: {
            eventType: ['UPDATE'],
            pk: [{ prefix: 'INVENTORY#' }],
            NewImage: {
              quantity: [{ numeric: ['<=', 100] }],
            },
          },
        },
      },
      targets: [new SnsTopic(inventoryStockTopic)],
    });
  }
}
