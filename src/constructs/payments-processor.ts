import { Arn, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CfnPipe } from 'aws-cdk-lib/aws-pipes';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

interface PaymentsProcessorProps {
  api: RestApi;
}

export class PaymentsProcessor extends Construct {
  private paymentsQueue: Queue;
  constructor(scope: Construct, id: string, props: PaymentsProcessorProps) {
    super(scope, id);

    const { api } = props;

    const paymentsPipeRole = new Role(this, 'PaymentsPipeRole', {
      assumedBy: new ServicePrincipal('pipes.amazonaws.com'),
    });

    const paymentsPipeLogs = new LogGroup(this, 'PaymentsPipeLogs', {
      logGroupName: '/aws/vendedlogs/pipes/paymentsPipeLogs',
      removalPolicy: RemovalPolicy.DESTROY,
      retention: RetentionDays.ONE_DAY,
    });

    const dlq = new Queue(this, 'PaymentsDlq', { queueName: 'payments-dlq' });

    this.paymentsQueue = new Queue(this, 'PaymentsQueue', {
      deadLetterQueue: { maxReceiveCount: 10, queue: dlq },
      queueName: 'payments-queue',
    });
    this.paymentsQueue.grantConsumeMessages(paymentsPipeRole);

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
      source: this.paymentsQueue.queueArn,
      target: Arn.format(
        {
          service: 'execute-api',
          resource: `${api.restApiId}/prod/POST/payments`,
        },
        Stack.of(this)
      ),
      targetParameters: {
        inputTemplate: `{
          "body": <$.body>
        }`,
      },
    });
  }

  getQueue() {
    return this.paymentsQueue;
  }
}
