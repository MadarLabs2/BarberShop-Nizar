import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { REQUEST_USER_KEY } from './auth.decorator';
import type { UserPayload } from './auth.service';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req[REQUEST_USER_KEY] as UserPayload | undefined;
    if (!user?.isAdmin) throw new ForbiddenException('Admin access required');
    return true;
  }
}
