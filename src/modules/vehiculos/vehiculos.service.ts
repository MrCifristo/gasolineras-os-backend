import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import {
  vehiculos,
  pilotosVehiculos,
  pilotos,
  clientes,
} from "../../db/schema";
import { CreateVehiculoDto } from "./dto/create-vehiculo.dto";
import { UpdateVehiculoDto } from "./dto/update-vehiculo.dto";
import { UpdateRestriccionesVehiculoDto } from "./dto/update-restricciones-vehiculo.dto";

@Injectable()
export class VehiculosService {
  constructor(private db: DbService) {}

  private readonly DECIMAL_FIELDS = [
    "limite_monto_transaccion",
    "limite_monto_dia",
    "limite_monto_semana",
    "limite_monto_mes",
    "limite_volumen_transaccion",
    "limite_volumen_dia",
    "limite_volumen_semana",
    "limite_volumen_mes",
  ] as const;

  private coerceDecimals(dto: Record<string, any>) {
    const out: Record<string, any> = { ...dto };
    for (const f of this.DECIMAL_FIELDS) {
      if (out[f] != null) out[f] = String(out[f]);
    }
    return out;
  }

  /** PartialType vuelve opcionales (y nulables) todos los campos; bloqueado es NOT NULL. */
  private rechazarBloqueadoNulo(dto: { bloqueado?: boolean | null }) {
    if (dto.bloqueado === null)
      throw new BadRequestException("bloqueado debe ser verdadero o falso");
  }

  /** Alcance fail-closed: un cliente sólo ve sus vehículos; sin cliente_id, nada. */
  async findAll(
    clienteId?: string,
    activo?: boolean,
    user?: { rol: string; cliente_id?: string | null },
  ) {
    if (user?.rol === "cliente") {
      if (!user.cliente_id) return [];
      clienteId = user.cliente_id;
    }
    const conditions = [eq(vehiculos.activo, activo ?? true)];
    if (clienteId) conditions.push(eq(vehiculos.cliente_id, clienteId));
    return this.db.db
      .select()
      .from(vehiculos)
      .where(and(...conditions));
  }

  async findOne(
    id: string,
    user?: { rol: string; cliente_id?: string | null },
  ) {
    const condiciones = [eq(vehiculos.id, id)];
    if (user?.rol === "cliente") {
      if (!user.cliente_id)
        throw new NotFoundException("Vehículo no encontrado");
      condiciones.push(eq(vehiculos.cliente_id, user.cliente_id));
    }
    const [row] = await this.db.db
      .select()
      .from(vehiculos)
      .where(and(...condiciones))
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
      if (p.plantilla_monto_transaccion != null)
        plantilla.limite_monto_transaccion = parseFloat(
          String(p.plantilla_monto_transaccion),
        );
      if (p.plantilla_monto_dia != null)
        plantilla.limite_monto_dia = parseFloat(String(p.plantilla_monto_dia));
      if (p.plantilla_monto_semana != null)
        plantilla.limite_monto_semana = parseFloat(
          String(p.plantilla_monto_semana),
        );
      if (p.plantilla_monto_mes != null)
        plantilla.limite_monto_mes = parseFloat(String(p.plantilla_monto_mes));
      if (p.plantilla_volumen_transaccion != null)
        plantilla.limite_volumen_transaccion = parseFloat(
          String(p.plantilla_volumen_transaccion),
        );
      if (p.plantilla_volumen_dia != null)
        plantilla.limite_volumen_dia = parseFloat(
          String(p.plantilla_volumen_dia),
        );
      if (p.plantilla_volumen_semana != null)
        plantilla.limite_volumen_semana = parseFloat(
          String(p.plantilla_volumen_semana),
        );
      if (p.plantilla_volumen_mes != null)
        plantilla.limite_volumen_mes = parseFloat(
          String(p.plantilla_volumen_mes),
        );
      if (p.plantilla_trans_dia != null)
        plantilla.limite_trans_dia = p.plantilla_trans_dia;
      if (p.plantilla_trans_semana != null)
        plantilla.limite_trans_semana = p.plantilla_trans_semana;
      if (p.plantilla_trans_mes != null)
        plantilla.limite_trans_mes = p.plantilla_trans_mes;
      if (p.plantilla_productos_permitidos?.length)
        plantilla.productos_permitidos = p.plantilla_productos_permitidos;
    }

    const merged = { ...plantilla, ...dto };
    const [row] = await this.db.db
      .insert(vehiculos)
      .values(this.coerceDecimals(merged) as any)
      .returning();
    return row;
  }

  async update(id: string, dto: UpdateVehiculoDto) {
    this.rechazarBloqueadoNulo(dto);
    await this.findOne(id);
    const [row] = await this.db.db
      .update(vehiculos)
      .set(this.coerceDecimals(dto) as any)
      .where(eq(vehiculos.id, id))
      .returning();
    return row;
  }

  /**
   * Alcance fail-closed: un cliente sólo toca vehículos de su cliente_id; si
   * el vehículo es ajeno o no existe, ambos casos dan el mismo 404. El filtro
   * va en el propio UPDATE, sin leer primero.
   */
  async updateRestricciones(
    id: string,
    dto: UpdateRestriccionesVehiculoDto,
    user: { rol: string; cliente_id?: string | null },
  ) {
    this.rechazarBloqueadoNulo(dto);
    const condiciones = [eq(vehiculos.id, id)];
    if (user.rol !== "admin") {
      if (!user.cliente_id)
        throw new NotFoundException("Vehículo no encontrado");
      condiciones.push(eq(vehiculos.cliente_id, user.cliente_id));
    }
    // Un cliente puede bloquear sus vehículos pero no desbloquearlos: eso lo
    // decide la estación. Siempre se rechaza (no sólo si está bloqueado) y,
    // como va antes del UPDATE, el resto de campos de la petición no se aplica.
    // Primero el alcance, para que un vehículo ajeno siga dando 404.
    if (user.rol === "cliente" && dto.bloqueado === false) {
      const [propio] = await this.db.db
        .select({ id: vehiculos.id })
        .from(vehiculos)
        .where(and(...condiciones))
        .limit(1);
      if (!propio) throw new NotFoundException("Vehículo no encontrado");
      throw new ForbiddenException(
        "Sólo la estación puede desbloquear un vehículo.",
      );
    }
    if (Object.keys(dto).length === 0) {
      const [actual] = await this.db.db
        .select()
        .from(vehiculos)
        .where(and(...condiciones))
        .limit(1);
      if (!actual) throw new NotFoundException("Vehículo no encontrado");
      return actual;
    }
    const [row] = await this.db.db
      .update(vehiculos)
      .set(this.coerceDecimals(dto) as any)
      .where(and(...condiciones))
      .returning();
    if (!row) throw new NotFoundException("Vehículo no encontrado");
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
