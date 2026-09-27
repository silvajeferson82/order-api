import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { REQUIRED_ROLES } from './roles.decorator';
import type { KeycloakJwtClaims } from './jwt.strategy';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.get<boolean>('AUTH_ENABLED')) return true;
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_ROLES,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles?.length) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const claims = request.user as KeycloakJwtClaims | undefined;
    const roles = claims?.resource_access?.['order-api']?.roles;
    if (
      !Array.isArray(roles) ||
      !requiredRoles.some((role) => roles.includes(role))
    ) {
      throw new ForbiddenException('Papel insuficiente');
    }
    return true;
  }
}
