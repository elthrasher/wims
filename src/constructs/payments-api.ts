import { Stack } from 'aws-cdk-lib';
import {
  RestApi,
  MockIntegration,
  PassthroughBehavior,
} from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';

export class PaymentsApi extends Construct {
  private api: RestApi;
  constructor(scope: Stack, id: string) {
    super(scope, id);

    // Payments is an external system so mocked here.
    this.api = new RestApi(this, 'WIMSPayments', {
      deployOptions: { throttlingBurstLimit: 5, throttlingRateLimit: 5 },
    });
    const payments = this.api.root.addResource('payments');
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
  }

  getApi() {
    return this.api;
  }
}
