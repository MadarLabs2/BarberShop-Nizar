import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { UserPayload } from './auth.service';

export const REQUEST_USER_KEY = 'requestUser';

export const RequestUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserPayload => {
    const req = ctx.switchToHttp().getRequest();
    return req[REQUEST_USER_KEY];
  },
);
