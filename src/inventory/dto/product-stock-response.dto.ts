import { ApiProperty } from '@nestjs/swagger';
import { StockMovementResponseDto } from './stock-movement-response.dto';

export class ProductStockResponseDto {
  @ApiProperty()
  productId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  sku!: string;

  @ApiProperty({ description: 'Current available stock quantity' })
  stock!: number;

  @ApiProperty({
    description: 'Indicates whether stock > 0 and product is active',
  })
  isAvailable!: boolean;

  @ApiProperty()
  isActive!: boolean;
}

export class InventoryOperationResultDto {
  @ApiProperty()
  success!: boolean;

  @ApiProperty()
  productId!: string;

  @ApiProperty({ description: 'Previous stock balance' })
  previousStock!: number;

  @ApiProperty({ description: 'Current stock balance after operation' })
  currentStock!: number;

  @ApiProperty({ type: StockMovementResponseDto })
  movement!: StockMovementResponseDto;
}
