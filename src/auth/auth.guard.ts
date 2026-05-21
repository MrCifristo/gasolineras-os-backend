import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import * as jwt from 'jsonwebtoken';
import { DbService } from '../db/db.service';
import { usuarios } from '../db/schema';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private config: ConfigService,
    private db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token requerido');
    }

    const token = authHeader.slice(7);
    const secret = this.config.get<string>('SUPABASE_JWT_SECRET');

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, secret!) as jwt.JwtPayload;
    } catch {
      throw new UnauthorizedException('Token inválido');
    }

    const supabaseUserId: string = payload['sub']!;
    const [usuario] = await this.db.db
      .select()
      .from(usuarios)
      .where(eq(usuarios.supabase_user_id, supabaseUserId))
      .limit(1);

    if (!usuario || !usuario.activo) {
      throw new UnauthorizedException('Usuario no autorizado');
    }

    request.user = usuario;
    return true;
  }
}
