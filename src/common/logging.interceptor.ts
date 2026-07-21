import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";

/**
 * Log de una línea por request exitoso: método, ruta y duración.
 *
 * Los errores no se loguean acá: el AllExceptionsFilter los captura todos,
 * incluidos los rechazos de guard (401 por token inválido), que ocurren antes
 * de que este interceptor corra. Así no hay doble log.
 *
 * Usa Date.now() adrede en vez del reloj del framework: sólo mide duración.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const inicio = Date.now();
    const { method, url } = req;

    return next
      .handle()
      .pipe(
        tap(() =>
          this.logger.log(`${method} ${url} → ${Date.now() - inicio}ms`),
        ),
      );
  }
}
