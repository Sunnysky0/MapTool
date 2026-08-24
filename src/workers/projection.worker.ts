/// <reference lib="webworker" />

import { createProjectionWorkerHandler } from './projection-worker-handler';
import { WORKER_PROTOCOL_VERSION, type ProjectionWorkerRequest } from './protocol';

const context = self as DedicatedWorkerGlobalScope;
const handler = createProjectionWorkerHandler();

context.addEventListener('message', (event: MessageEvent<ProjectionWorkerRequest>) => {
  const request = event.data;
  if (request.protocolVersion !== WORKER_PROTOCOL_VERSION) return;
  void handler.handle(request).then((response) => {
    if (response) context.postMessage(response);
  });
});

export {};
