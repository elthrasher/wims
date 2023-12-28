import { DynamoDBStreamEvent } from "aws-lambda";
import { AttributeValue } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { PROJECT_SOURCE } from "../constants";

const eb = new EventBridgeClient({});

export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  for (const record of event.Records) {
    console.log("CDC record: ", JSON.stringify(record));
    if (record.dynamodb) {
      const newImage =
        record.dynamodb.NewImage &&
        unmarshall(
          record.dynamodb.NewImage as { [key: string]: AttributeValue }
        );
      const oldImage =
        record.dynamodb.OldImage &&
        unmarshall(
          record.dynamodb.OldImage as { [key: string]: AttributeValue }
        );
      if (oldImage && newImage) {
        const columns = Object.keys({ ...newImage, ...oldImage });
        const columnsChanged = columns.filter(
          (key) => newImage[key] !== oldImage[key]
        );
        const before = columnsChanged.reduce(
          (acc, key) => ({ ...acc, [key]: oldImage[key] }),
          {}
        );
        const after = columnsChanged.reduce(
          (acc, key) => ({ ...acc, [key]: newImage[key] }),
          {}
        );
        await eb.send(
          new PutEventsCommand({
            Entries: [
              {
                EventBusName: process.env.EVENT_BUS_NAME,
                Source: PROJECT_SOURCE,
                DetailType: "cdc.update",
                Detail: JSON.stringify({
                  meta: {
                    fn: process.env.AWS_LAMBDA_FUNCTION_NAME,
                  },
                  data: {
                    columnsChanged,
                    table: process.env.TABLE_NAME,
                    before: JSON.stringify({ ...before }),
                    after: JSON.stringify({ ...after }),
                  },
                }),
              },
            ],
          })
        );
      } else if (oldImage) {
        const columnsChanged = Object.keys(oldImage);
        const before = columnsChanged.reduce(
          (acc, key) => ({ ...acc, [key]: oldImage[key] }),
          {}
        );
        await eb.send(
          new PutEventsCommand({
            Entries: [
              {
                EventBusName: process.env.EVENT_BUS_NAME,
                Source: PROJECT_SOURCE,
                DetailType: "cdc.delete",
                Detail: JSON.stringify({
                  meta: {
                    fn: process.env.AWS_LAMBDA_FUNCTION_NAME,
                  },
                  data: {
                    table: process.env.TABLE_NAME,
                    columnsChanged,
                    before: JSON.stringify({ ...before }),
                  },
                }),
              },
            ],
          })
        );
      } else if (newImage) {
        const columnsChanged = Object.keys(newImage);
        const after = columnsChanged.reduce(
          (acc, key) => ({ ...acc, [key]: newImage[key] }),
          {}
        );
        await eb.send(
          new PutEventsCommand({
            Entries: [
              {
                EventBusName: process.env.EVENT_BUS_NAME,
                Source: PROJECT_SOURCE,
                DetailType: "cdc.insert",
                Detail: JSON.stringify({
                  meta: {
                    fn: process.env.AWS_LAMBDA_FUNCTION_NAME,
                  },
                  data: {
                    table: process.env.TABLE_NAME,
                    columnsChanged,
                    after: JSON.stringify({ ...after }),
                  },
                }),
              },
            ],
          })
        );
      }
    }
  }
};
