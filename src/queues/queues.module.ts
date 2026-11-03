import { Global, Module } from '@nestjs/common';
import { OrderExpirationQueueService } from './order-expiration.queue';

@Global()
@Module({
  providers: [OrderExpirationQueueService],
  exports: [OrderExpirationQueueService],
})
export class QueuesModule {}
