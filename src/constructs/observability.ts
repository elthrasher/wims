import { Construct } from 'constructs';
import { PROJECT_SOURCE } from '../constants';
import { RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Rule, EventBus } from 'aws-cdk-lib/aws-events';
import { CloudWatchLogGroup } from 'aws-cdk-lib/aws-events-targets';
import { CfnDiscoverer } from 'aws-cdk-lib/aws-eventschemas';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';

export class ObservabilityConstruct extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const observerLogs = new LogGroup(this, 'observerLogs', {
      logGroupName: `/aws/vendedlogs/observer/event-logs`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: RetentionDays.ONE_DAY,
    });

    new Rule(this, 'observerRule', {
      eventPattern: {
        source: [PROJECT_SOURCE],
      },
      targets: [new CloudWatchLogGroup(observerLogs)],
    });

    const bus = EventBus.fromEventBusName(this, 'bus', `default`);
    bus.archive('freeCodeCampArchive', {
      archiveName: 'freeCodeCampArchive',
      description: `freeCodeCampArchive`,
      eventPattern: {
        source: [PROJECT_SOURCE],
      },
      retention: Duration.days(1),
    });
    new CfnDiscoverer(this, `Discoverer`, {
      sourceArn: bus.eventBusArn,
      description: 'freeCodeCamp EDA Discoverer',
      crossAccount: false,
    });
  }
}
