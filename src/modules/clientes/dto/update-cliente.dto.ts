import { OmitType, PartialType } from "@nestjs/swagger";
import { CreateClienteDto } from "./create-cliente.dto";

/**
 * `saldo_inicial` queda fuera a propósito: es el movimiento de apertura de la
 * cuenta y no se puede reescribir después. Para corregir el saldo se registra
 * un abono, que deja rastro en el ledger. Con `forbidNonWhitelisted`, mandarlo
 * en un PATCH devuelve 400 en vez de ignorarse en silencio.
 */
export class UpdateClienteDto extends PartialType(
  OmitType(CreateClienteDto, ["saldo_inicial"] as const),
) {}
