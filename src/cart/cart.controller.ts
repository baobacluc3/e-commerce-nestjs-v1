import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { CartResponseDto } from './dto/cart-response.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@ApiTags('cart')
@ApiBearerAuth()
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @ApiOperation({
    summary: "Get current user's cart with live prices and availability",
  })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @Get()
  async getCart(@CurrentUser() user: AuthUser): Promise<CartResponseDto> {
    return this.cartService.getCart(user.userId);
  }

  @ApiOperation({
    summary: 'Add an item to cart or increment quantity',
  })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiBadRequestResponse({ description: 'Inactive product' })
  @ApiConflictResponse({
    description: 'Out of stock or exceeds available stock',
  })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @Post('items')
  async addItem(
    @CurrentUser() user: AuthUser,
    @Body() dto: AddCartItemDto,
  ): Promise<CartResponseDto> {
    return this.cartService.addItem(user.userId, dto);
  }

  @ApiOperation({
    summary: 'Update item quantity in cart',
  })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiConflictResponse({ description: 'Requested quantity exceeds stock' })
  @ApiNotFoundResponse({ description: 'Item not found in cart' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @Patch('items/:id')
  async updateItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CartResponseDto> {
    return this.cartService.updateItem(user.userId, id, dto);
  }

  @ApiOperation({
    summary: 'Remove an item from cart',
  })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiNotFoundResponse({ description: 'Item not found in cart' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @Delete('items/:id')
  async removeItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<CartResponseDto> {
    return this.cartService.removeItem(user.userId, id);
  }

  @ApiOperation({
    summary: 'Clear all items from current user cart',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Cart cleared successfully' },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @HttpCode(HttpStatus.OK)
  @Delete()
  async clearCart(
    @CurrentUser() user: AuthUser,
  ): Promise<{ success: boolean; message: string }> {
    return this.cartService.clearCart(user.userId);
  }
}
