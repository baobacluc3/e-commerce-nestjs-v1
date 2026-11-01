/* eslint-disable @typescript-eslint/unbound-method */
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { RolesGuard } from '../auth/roles.guard';
import { Role } from '../generated/prisma/enums';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

describe('AdminController (Role Enforcement on Every Route)', () => {
  let controller: AdminController;
  let rolesGuard: RolesGuard;
  let reflector: Reflector;

  const mockAdminService = {
    getMetrics: jest.fn().mockResolvedValue({}),
    findAllOrders: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    findOrderById: jest.fn().mockResolvedValue({}),
    updateOrderStatus: jest.fn().mockResolvedValue({}),
    adjustStock: jest.fn().mockResolvedValue({}),
    getLowStock: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    getMovements: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  };

  beforeEach(async () => {
    reflector = new Reflector();
    rolesGuard = new RolesGuard(reflector);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        {
          provide: AdminService,
          useValue: mockAdminService,
        },
      ],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  const createExecutionContext = (
    handler: (...args: unknown[]) => unknown,
    userRole?: Role,
  ): ExecutionContext => {
    return {
      getHandler: () => handler,
      getClass: () => AdminController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: userRole ? { userId: 'test-user', role: userRole } : undefined,
        }),
      }),
    } as unknown as ExecutionContext;
  };

  it('controller is defined', () => {
    expect(controller).toBeDefined();
  });

  const adminRoutes: Array<{
    name: string;
    handler: (...args: unknown[]) => unknown;
  }> = [
    {
      name: 'GET /admin/metrics',
      handler: AdminController.prototype.getMetrics,
    },
    {
      name: 'GET /admin/orders',
      handler: AdminController.prototype.findAllOrders,
    },
    {
      name: 'GET /admin/orders/:id',
      handler: AdminController.prototype.findOrderById,
    },
    {
      name: 'PATCH /admin/orders/:id/status',
      handler: AdminController.prototype.updateOrderStatus,
    },
    {
      name: 'POST /admin/inventory/adjust',
      handler: AdminController.prototype.adjustStock,
    },
    {
      name: 'GET /admin/inventory/low-stock',
      handler: AdminController.prototype.getLowStock,
    },
    {
      name: 'GET /admin/inventory/movements',
      handler: AdminController.prototype.getMovements,
    },
  ];

  describe.each(adminRoutes)('Endpoint $name', ({ handler }) => {
    it('returns 403 Forbidden for a CUSTOMER token', () => {
      const context = createExecutionContext(handler, Role.CUSTOMER);
      expect(() => rolesGuard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('returns 403 Forbidden when no user or role is attached to the request', () => {
      const context = createExecutionContext(handler, undefined);
      expect(() => rolesGuard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('allows access for an ADMIN token', () => {
      const context = createExecutionContext(handler, Role.ADMIN);
      expect(rolesGuard.canActivate(context)).toBe(true);
    });
  });
});
