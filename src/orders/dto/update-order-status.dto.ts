import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { OrderStatus } from '../../generated/prisma/enums';

export class UpdateOrderStatusDto {
  @ApiProperty({
    enum: OrderStatus,
    example: OrderStatus.SHIPPED,
    description: 'Target order status',
  })
  @IsEnum(OrderStatus)
  status!: OrderStatus;
}
