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
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { CreateProductDto } from './dto/create-product.dto';
import {
  PaginatedProductsResponseDto,
  ProductResponseDto,
} from './dto/product-response.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a new product (Admin only)' })
  @ApiConflictResponse({ description: 'SKU or slug already exists' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN role' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @Post()
  async create(
    @Body() dto: CreateProductDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ProductResponseDto> {
    return this.productsService.create(dto, user.userId);
  }

  @Public()
  @ApiOperation({
    summary: 'Browse products with pagination, filters, and search',
  })
  @ApiOkResponse({ type: PaginatedProductsResponseDto })
  @Get()
  async findAll(
    @Query() query: QueryProductsDto,
  ): Promise<PaginatedProductsResponseDto> {
    return this.productsService.findAll(query);
  }

  @Public()
  @ApiOperation({ summary: 'Get product details by ID' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ProductResponseDto> {
    return this.productsService.findById(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update product details (Admin only)' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN role' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.update(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Deactivate product (Admin only)' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN role' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.productsService.remove(id);
  }
}
