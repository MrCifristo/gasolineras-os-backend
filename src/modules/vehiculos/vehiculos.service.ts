import { Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { vehiculos, pilotosVehiculos, pilotos, clientes } from "../../db/schema";
import { CreateVehiculoDto } from "./dto/create-vehiculo.dto";
import { UpdateVehiculoDto } from "./dto/update-vehiculo.dto";

@Injectable()
export class VehiculosService {
  constructor(private db: DbService) {}

  private readonly DECIMAL_FIELDS = [
    "limite_monto_transaccion", "limite_monto_dia", "limite_monto_semana", "limite_monto_mes",
    "limite_volumen_transaccion", "limite_volumen_dia", "limite_volumen_semana", "limite_volumen_mes",
  ] as const;

  private coerceDecimals(dto: Record<string, any>) {
    const out: Record<string, any> = { ...dto };
    for (const f of this.DECIMAL_FIELDS) {
      if (out[f] != null) out[f] = String(out[f]);
    }
    return out;
  }

  findAll(clienteId?: string, activo?: boolean) {
    const conditions = [eq(vehiculos.activo, activo ?? true)];
    if (clienteId) conditions.push(eq(vehiculos.cliente_id, clienteId));
    return this.db.db
      .select()
      .from(vehiculos)
      .where(and(...conditions));
  }

  async findOne(id: string) {
    const [row] = await this.db.db
      .select()
      .from(vehiculos)
      .where(eq(vehiculos.id, id))
      .limit(1);
    if (!row) throw new NotFoundException("Vehículo no encontrado");
    return row;
  }

  async create(dto: CreateVehiculoDto) {
    const [cli] = await this.db.db
      .select()
      .from(clientes)
      .where(eq(clientes.id, dto.cliente_id))
      .limit(1);

    const plantilla: Partial<typeof dto> = {};
    if (cli) {
      const p = cli;
      if (p.plantilla_monto_transaccion != null)    plantilla.limite_monto_transaccion   = parseFloat(String(p.plantilla_monto_transaccion));
      if (p.plantilla_monto_dia != null)            plantilla.limite_monto_dia           = parseFloat(String(p.plantilla_monto_dia));
      if (p.plantilla_monto_semana != null)         plantilla.limite_monto_semana        = parseFloat(String(p.plantilla_monto_semana));
      if (p.plantilla_monto_mes != null)            plantilla.limite_monto_mes           = parseFloat(String(p.plantilla_monto_mes));
      if (p.plantilla_volumen_transaccion != null)  plantilla.limite_volumen_transaccion = parseFloat(String(p.plantilla_volumen_transaccion));
      if (p.plantilla_volumen_dia != null)          plantilla.limite_volumen_dia         = parseFloat(String(p.plantilla_volumen_dia));
      if (p.plantilla_volumen_semana != null)       plantilla.limite_volumen_semana      = parseFloat(String(p.plantilla_volumen_semana));
      if (p.plantilla_volumen_mes != null)          plantilla.limite_volumen_mes         = parseFloat(String(p.plantilla_volumen_mes));
      if (p.plantilla_trans_dia != null)            plantilla.limite_trans_dia           = p.plantilla_trans_dia;
      if (p.plantilla_trans_semana != null)         plantilla.limite_trans_semana        = p.plantilla_trans_semana;
      if (p.plantilla_trans_mes != null)            plantilla.limite_trans_mes           = p.plantilla_trans_mes;
      if (p.plantilla_productos_permitidos?.length) plantilla.productos_permitidos        = p.plantilla_productos_permitidos as string[];
    }

    const merged = { ...plantilla, ...dto };
    const [row] = await this.db.db
      .insert(vehiculos)
      .values(this.coerceDecimals(merged) as any)
      .returning();
    return row;
  }

  async update(id: string, dto: UpdateVehiculoDto) {
    await this.findOne(id);
    const [row] = await this.db.db
      .update(vehiculos)
      .set(this.coerceDecimals(dto) as any)
      .where(eq(vehiculos.id, id))
      .returning();
    return row;
  }

  async remove(id: string) {
    await this.findOne(id);
    const [row] = await this.db.db
      .update(vehiculos)
      .set({ activo: false })
      .where(eq(vehiculos.id, id))
      .returning();
    return row;
  }

  async asignarPiloto(vehiculoId: string, pilotoId: string) {
    await this.findOne(vehiculoId);
    const [row] = await this.db.db
      .insert(pilotosVehiculos)
      .values({ vehiculo_id: vehiculoId, piloto_id: pilotoId })
      .onConflictDoNothing()
      .returning();
    return row;
  }

  async desasignarPiloto(vehiculoId: string, pilotoId: string) {
    await this.db.db
      .delete(pilotosVehiculos)
      .where(
        and(
          eq(pilotosVehiculos.vehiculo_id, vehiculoId),
          eq(pilotosVehiculos.piloto_id, pilotoId),
        ),
      );
    return { message: "Piloto desasignado" };
  }

  async getPilotos(vehiculoId: string) {
    return this.db.db
      .select({ piloto: pilotos })
      .from(pilotosVehiculos)
      .innerJoin(pilotos, eq(pilotosVehiculos.piloto_id, pilotos.id))
      .where(eq(pilotosVehiculos.vehiculo_id, vehiculoId));
  }
}
