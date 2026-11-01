import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../generated/prisma/enums';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  const createMockContext = (user?: { role?: Role }) => {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  };

  it('allows access if no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const context = createMockContext({ role: Role.CUSTOMER });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access when user has the required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

    const context = createMockContext({ role: Role.ADMIN });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException when user does not have required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

    const context = createMockContext({ role: Role.CUSTOMER });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when request has no user', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

    const context = createMockContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
