import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

/**
 * Filtro global de excepciones.
 *
 * Las HttpException (400/401/403/404…) se devuelven tal cual: son mensajes
 * pensados para el cliente. Cualquier otra cosa es un fallo no previsto: se
 * loguea completa del lado del servidor y al cliente sólo le llega un 500
 * genérico, para no filtrar stack traces ni internals de la base.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exceptions");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // Los 5xx que ya vienen como HttpException también se loguean: son la
      // única traza que queda de un fallo del servidor.
      if (status >= 500) {
        this.logger.error(`${req.method} ${req.url}`, exception.stack);
      } else if (status === 401 || status === 403) {
        // Rechazos de auth: los del guard ocurren antes del interceptor, así que
        // ésta es su única traza. Da forense de intentos con token inválido.
        this.logger.warn(`${req.method} ${req.url} ${status}`);
      }
      return res.status(status).json(exception.getResponse());
    }

    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    this.logger.error(
      `${req.method} ${req.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    res.status(status).json({
      statusCode: status,
      message: "Error interno del servidor",
    });
  }
}
