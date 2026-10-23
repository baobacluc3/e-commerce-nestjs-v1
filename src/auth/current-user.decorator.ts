import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '../generated/prisma/enums';

// What the JWT strategy puts on `request.user` (added in Task 7).
export interface AuthUser {
  userId: string;
  role: Role;
}

// Use in a controller: `me(@CurrentUser() user: AuthUser)`.
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<{ user: AuthUser }>();
    return request.user;
  },
);
