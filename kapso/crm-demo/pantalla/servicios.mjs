// Servicios de AWS que usa la lectura automatica. Van aparte para que las pruebas no los necesiten.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

const bedrock = new BedrockRuntimeClient({});
const lambda = new LambdaClient({});

export const conversar = (solicitud) => bedrock.send(new ConverseCommand(solicitud));

/** Lanza una tarea en segundo plano en este mismo programa, sin esperar a que termine. */
export const despachar = (tarea) =>
  lambda.send(new InvokeCommand({ FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(tarea)) }));
