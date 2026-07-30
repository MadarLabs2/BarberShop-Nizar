import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { REQUEST_USER_KEY } from './auth.decorator';

@Injectable()
export class TokenAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const auth = req.headers?.authorization;
    const token = auth?.replace(/^Bearer\s+/i, '')?.trim();
    if (!token) throw new UnauthorizedException('Missing token');

    const user = await this.auth.me(token);
    if (!user) throw new UnauthorizedException('Invalid token');

    req[REQUEST_USER_KEY] = user;
    return true;
  }
}
