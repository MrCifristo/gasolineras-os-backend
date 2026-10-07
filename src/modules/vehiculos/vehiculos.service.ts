import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, getTableColumns, getTableName, sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import {
  vehiculos,
  pilotosVehiculos,
  pilotos,
  clientes,
  despachos,
} from "../../db/schema";
import { CreateVehiculoDto } from "./dto/create-vehiculo.dto";
import { UpdateVehiculoDto } from "./dto/update-vehiculo.dto";
import { UpdateRestriccionesVehiculoDto } from "./dto/update-restricciones-vehiculo.dto";
import {
  clienteIdDeAlcance,
  clienteIdParaCrear,
  coercerDecimales,
  errorPorPlacaDuplicada,
  intentaDesbloquear,
  normalizarPlaca,
  plantillaDesdeCliente,
  rechazarBloqueadoNulo,
  rechazarCambioDePlaca,
  rechazarOtraEmpresa,
} from "./vehiculos.reglas";

type Usuario = { rol: string; cliente_id?: string | null };

@Injectable()
export class VehiculosService {
  constructor(private db: DbService) {}

  /** Último kilometraje registrado: una subconsulta correlacionada, sin N+1. */
  private columnas() {
    // Las columnas de Drizzle salen sin calificar en un select de una tabla y
    // chocarían dentro de la subconsulta: se califican con el nombre de tabla.
    const d = sql.identifier(getTableName(despachos));
    const v = sql.identifier(getTableName(vehiculos));
    return {
      ...getTableColumns(vehiculos),
      ultimo_kilometraje: sql<
        string | null
      >`(select max(${d}.${sql.identifier(despachos.kilometraje.name)}) from ${despachos} where ${d}.${sql.identifier(despachos.vehiculo_id.name)} = ${v}.${sql.identifier(vehiculos.id.name)})`,
    };
  }

  /** Alcance fail-closed: un cliente sólo ve sus vehículos; sin cliente_id, nada. */
  async findAll(clienteId?: string, activo?: boolean, user?: Usuario) {
    if (user?.rol === "cliente") {
      if (!user.cliente_id) return [];
      clienteId = user.cliente_id;
    }
    const conditions = [eq(vehiculos.activo, activo ?? true)];
    if (clienteId) conditions.push(eq(vehiculos.cliente_id, clienteId));
    return this.db.db
      .select(this.columnas())
      .from(vehiculos)
      .where(and(...conditions));
  }

  async findOne(id: string, user?: Usuario) {
    const condiciones = [eq(vehiculos.id, id)];
    if (user?.rol === "cliente") {
      if (!user.cliente_id)
        throw new NotFoundException("Vehículo no encontrado");
      condiciones.push(eq(vehiculos.cliente_id, user.cliente_id));
    }
    const [row] = await this.db.db
      .select(this.columnas())
      .from(vehiculos)
      .where(and(...condiciones))
      .limit(1);
    if (!row) throw new NotFoundException("Vehículo no encontrado");
    return row;
  }

  async create(dto: CreateVehiculoDto, user: Usuario) {
    const cliente_id = clienteIdParaCrear(user, dto.cliente_id);
    const [cli] = await this.db.db
      .select()
      .from(clientes)
      .where(eq(clientes.id, cliente_id))
      .limit(1);

    const plantilla = plantillaDesdeCliente(cli);

    const merged = {
      ...plantilla,
      ...dto,
      cliente_id,
      placa: normalizarPlaca(dto.placa),
    };
    try {
      const [row] = await this.db.db
        .insert(vehiculos)
        .values(coercerDecimales(merged) as any)
        .returning();
      return row;
    } catch (e) {
      throw errorPorPlacaDuplicada(e);
    }
  }

  /**
   * Alcance fail-closed (igual que updateRestricciones): el filtro por
   * cliente_id va en el propio UPDATE. El cliente bloquea pero no desbloquea
   * y no puede mover el vehículo a otra empresa.
   */
  async update(id: string, dto: UpdateVehiculoDto, user: Usuario) {
    rechazarBloqueadoNulo(dto);
    const clienteId = clienteIdDeAlcance(user);
    rechazarOtraEmpresa(user, dto.cliente_id);
    const condiciones = [eq(vehiculos.id, id)];
    if (clienteId) condiciones.push(eq(vehiculos.cliente_id, clienteId));
    if (dto.placa !== undefined)
      dto = { ...dto, placa: normalizarPlaca(dto.placa) };
    const cambiaPlaca = user.rol === "cliente" && dto.placa !== undefined;
    if (intentaDesbloquear(user, dto) || cambiaPlaca) {
      const [propio] = await this.db.db
        .select({ id: vehiculos.id, placa: vehiculos.placa })
        .from(vehiculos)
        .where(and(...condiciones))
        .limit(1);
      if (!propio) throw new NotFoundException("Vehículo no encontrado");
      if (intentaDesbloquear(user, dto))
        throw new ForbiddenException(
          "Sólo la estación puede desbloquear un vehículo.",
        );
      rechazarCambioDePlaca(user, dto.placa as string, propio.placa);
    }
    if (Object.keys(dto).length === 0) return this.findOne(id, user);
    try {
      const [row] = await this.db.db
        .update(vehiculos)
        .set(coercerDecimales(dto) as any)
        .where(and(...condiciones))
        .returning();
      if (!row) throw new NotFoundException("Vehículo no encontrado");
      return row;
    } catch (e) {
      throw errorPorPlacaDuplicada(e);
    }
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
    rechazarBloqueadoNulo(dto);
    const condiciones = [eq(vehiculos.id, id)];
    const clienteId = clienteIdDeAlcance(user);
    if (clienteId) condiciones.push(eq(vehiculos.cliente_id, clienteId));
    // Un cliente puede bloquear sus vehículos pero no desbloquearlos: eso lo
    // decide la estación. Siempre se rechaza (no sólo si está bloqueado) y,
    // como va antes del UPDATE, el resto de campos de la petición no se aplica.
    // Primero el alcance, para que un vehículo ajeno siga dando 404.
    if (intentaDesbloquear(user, dto)) {
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
      .set(coercerDecimales(dto) as any)
      .where(and(...condiciones))
      .returning();
    if (!row) throw new NotFoundException("Vehículo no encontrado");
    return row;
  }

  async remove(id: string, user: Usuario) {
    const clienteId = clienteIdDeAlcance(user);
    const condiciones = [eq(vehiculos.id, id)];
    if (clienteId) condiciones.push(eq(vehiculos.cliente_id, clienteId));
    const [row] = await this.db.db
      .update(vehiculos)
      .set({ activo: false })
      .where(and(...condiciones))
      .returning();
    if (!row) throw new NotFoundException("Vehículo no encontrado");
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
