import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { REQUEST_USER_KEY } from './auth.decorator';
import type { UserPayload } from './auth.service';

/** Allows admin or a user with a linked staff profile (`user.staffId`). Admin alone does not imply `staffId`. */
@Injectable()
export class StaffOrAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req[REQUEST_USER_KEY] as UserPayload | undefined;
    if (!user?.isAdmin && !user?.staffId) throw new ForbiddenException('Staff or admin access required');
    return true;
  }
}

/** Allows only staff (user.staffId). Used for staff-only endpoints like my-appointments. */
@Injectable()
export class StaffGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req[REQUEST_USER_KEY] as UserPayload | undefined;
    if (!user?.staffId) throw new ForbiddenException('Staff access required');
    return true;
  }
}
