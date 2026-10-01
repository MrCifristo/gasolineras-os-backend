import { PartialType, PickType } from "@nestjs/swagger";
import { CreateVehiculoDto } from "./create-vehiculo.dto";

/**
 * Sólo los campos de restricción del vehículo, con las mismas validaciones
 * que en CreateVehiculoDto. Cualquier otra clave (placa, cliente_id...) la
 * rechaza forbidNonWhitelisted con 400.
 */
export class UpdateRestriccionesVehiculoDto extends PartialType(
  PickType(CreateVehiculoDto, [
    "bloqueado",
    "limite_monto_transaccion",
    "limite_monto_dia",
    "limite_monto_semana",
    "limite_monto_mes",
    "limite_volumen_transaccion",
    "limite_volumen_dia",
    "limite_volumen_semana",
    "limite_volumen_mes",
    "limite_trans_dia",
    "limite_trans_semana",
    "limite_trans_mes",
    "productos_permitidos",
    "dias_permitidos",
    "hora_inicio",
    "hora_fin",
  ] as const),
) {}
