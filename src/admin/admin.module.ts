import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersModule } from '../orders/orders.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [OrdersModule, InventoryModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
