import { RemovalPolicy } from 'aws-cdk-lib';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CfnPipe } from 'aws-cdk-lib/aws-pipes';
import { Construct } from 'constructs';

import { CDC_EVENT, PROJECT_SOURCE } from '../constants';

export interface CDCProps {
  table: TableV2;
}

export class CDC extends Construct {
  constructor(scope: Construct, id: string, props: CDCProps) {
    super(scope, id);

    const { table } = props;

    const cdcEnrichmentFn = new NodejsFunction(this, 'CDCEnrichment', {
      entry: './src/fns/cdc-enrichment.ts',
      functionName: 'cdc-enrichment',
      logRetention: RetentionDays.ONE_WEEK,
      runtime: Runtime.NODEJS_20_X,
    });

    const bus = EventBus.fromEventBusName(this, 'DefaultBus', 'default');

    const cdcPipeRole = new Role(this, 'CDCPipeRole', {
      assumedBy: new ServicePrincipal('pipes.amazonaws.com'),
    });

    const cdcPipeLogs = new LogGroup(this, 'CDCPipeLogs', {
      logGroupName: '/aws/vendedlogs/pipes/cdcPipeLogs',
      removalPolicy: RemovalPolicy.DESTROY,
      retention: RetentionDays.ONE_DAY,
    });

    bus.grantPutEventsTo(cdcPipeRole);
    cdcEnrichmentFn.grantInvoke(cdcPipeRole);

    table.grantStreamRead(cdcPipeRole);

    new CfnPipe(this, 'CDCStreamPipe', {
      enrichment: cdcEnrichmentFn.functionArn,
      logConfiguration: {
        cloudwatchLogsLogDestination: {
          logGroupArn: cdcPipeLogs.logGroupArn,
        },
        includeExecutionData: ['ALL'],
        level: 'INFO',
      },
      name: 'CDCStreamPipe',
      roleArn: cdcPipeRole.roleArn,
      source: table.tableStreamArn!,
      sourceParameters: {
        dynamoDbStreamParameters: { batchSize: 10, startingPosition: 'LATEST' },
      },
      target: bus.eventBusArn,
      targetParameters: {
        eventBridgeEventBusParameters: {
          source: PROJECT_SOURCE,
          detailType: CDC_EVENT,
        },
      },
    });
  }
}
