import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId?: string;
  orderId?: number;
  generation?: number;
  processingRun?: number;
  eventId?: string;
  eventType?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(context: RequestContext, callback: () => T): T {
    return storage.run(context, callback);
  },
  current(): RequestContext | undefined {
    return storage.getStore();
  },
};
