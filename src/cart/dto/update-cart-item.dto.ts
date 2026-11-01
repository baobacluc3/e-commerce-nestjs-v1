import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class UpdateCartItemDto {
  @ApiProperty({
    example: 3,
    description: 'Updated quantity of the product in the cart',
  })
  @IsInt()
  @Min(1)
  quantity!: number;
}
