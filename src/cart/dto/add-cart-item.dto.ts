import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsUUID, Min } from 'class-validator';

export class AddCartItemDto {
  @ApiProperty({
    example: '0192e20d-b8d4-7221-8eb9-ccefa93430ee',
    description: 'UUID of the product to add',
  })
  @IsUUID('all')
  @IsNotEmpty()
  productId!: string;

  @ApiPropertyOptional({
    example: 1,
    default: 1,
    description: 'Quantity of product to add',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  quantity: number = 1;
}
