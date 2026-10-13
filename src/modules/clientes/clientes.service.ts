import { Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import {
  clientes,
  vehiculos,
  pilotos,
  saldosCliente,
  movimientosSaldo,
} from "../../db/schema";
import { CreateClienteDto } from "./dto/create-cliente.dto";
import { UpdateClienteDto } from "./dto/update-cliente.dto";
import { decimalesATexto } from "../../common/decimales";
import {
  claveNit,
  errorPorNitDuplicado,
  errorPorNitDuplicadoPg,
  normalizarNit,
} from "./clientes.reglas";

@Injectable()
export class ClientesService {
  constructor(private db: DbService) {}

  private readonly CLIENTE_DECIMAL_FIELDS = [
    "limite_monto_dia",
    "limite_monto_semana",
    "limite_monto_mes",
    "plantilla_monto_transaccion",
    "plantilla_monto_dia",
    "plantilla_monto_semana",
    "plantilla_monto_mes",
    "plantilla_volumen_transaccion",
    "plantilla_volumen_dia",
    "plantilla_volumen_semana",
    "plantilla_volumen_mes",
  ] as const;

  private coerceDecimales<T extends object>(dto: T) {
    return decimalesATexto(dto, this.CLIENTE_DECIMAL_FIELDS);
  }

  findAll(user?: { rol: string; cliente_id?: string | null }) {
    const condiciones = [eq(clientes.activo, true)];
    if (user?.rol === "cliente") {
      if (!user.cliente_id) return Promise.resolve([]);
      condiciones.push(eq(clientes.id, user.cliente_id));
    }
    return this.db.db
      .select()
      .from(clientes)
      .where(and(...condiciones));
  }

  async findOne(
    id: string,
    user?: { rol: string; cliente_id?: string | null },
  ) {
    if (user?.rol === "cliente" && user.cliente_id !== id)
      throw new NotFoundException("Cliente no encontrado");
    const [cliente] = await this.db.db
      .select()
      .from(clientes)
      .where(and(eq(clientes.id, id), eq(clientes.activo, true)))
      .limit(1);
    if (!cliente) throw new NotFoundException("Cliente no encontrado");

    const [clienteVehiculos, clientePilotos] = await Promise.all([
      this.db.db
        .select()
        .from(vehiculos)
        .where(and(eq(vehiculos.cliente_id, id), eq(vehiculos.activo, true))),
      this.db.db
        .select()
        .from(pilotos)
        .where(and(eq(pilotos.cliente_id, id), eq(pilotos.activo, true))),
    ]);

    return { ...cliente, vehiculos: clienteVehiculos, pilotos: clientePilotos };
  }

  /**
   * 409 si el NIT ya es de otro cliente, activo o desactivado (ver
   * `claveNit`). El índice `clientes_nit_unico` cubre la carrera entre dos
   * altas; esta consulta existe para poder nombrar al cliente que ya lo tiene.
   */
  private async exigirNitLibre(nit: string, excluirId?: string) {
    const clave = claveNit(nit);
    if (!clave) return;
    const condiciones = [
      sql`upper(replace(${clientes.nit}, '-', '')) = ${clave}`,
    ];
    if (excluirId) condiciones.push(ne(clientes.id, excluirId));
    const [existente] = await this.db.db
      .select({ nombre: clientes.nombre, activo: clientes.activo })
      .from(clientes)
      .where(and(...condiciones))
      .limit(1);
    if (existente) throw errorPorNitDuplicado(nit, existente);
  }

  async create(dto: CreateClienteDto) {
    // saldo_inicial no es una columna de `clientes`: hay que sacarlo antes del
    // insert o rompería, porque coerceDecimales vuelca el dto entero.
    const { saldo_inicial, ...resto } = dto;
    const datos = { ...resto, nit: normalizarNit(resto.nit) };
    const apertura = saldo_inicial ?? 0;
    if (datos.nit) await this.exigirNitLibre(datos.nit);

    try {
      return await this.crearConSaldo(datos, apertura);
    } catch (e) {
      throw errorPorNitDuplicadoPg(e);
    }
  }

  private crearConSaldo(
    datos: Omit<CreateClienteDto, "saldo_inicial">,
    apertura: number,
  ) {
    return this.db.db.transaction(async (tx) => {
      const [cliente] = await tx
        .insert(clientes)
        .values(this.coerceDecimales(datos))
        .returning();

      // El saldo arranca en 0 para que los despachos tengan de dónde descontar.
      await tx.insert(saldosCliente).values({
        cliente_id: cliente.id,
        saldo_actual: String(apertura),
      });

      // La apertura entra al ledger como cualquier otro movimiento, para que el
      // estado de cuenta cuadre. Sin gasolinera: no ocurrió en ninguna estación.
      if (apertura > 0) {
        await tx.insert(movimientosSaldo).values({
          cliente_id: cliente.id,
          gasolinera_id: null,
          tipo: "credito",
          monto: String(apertura),
          descripcion: "Saldo inicial",
        });
      }

      return cliente;
    });
  }

  async update(id: string, dto: UpdateClienteDto) {
    await this.findOne(id);
    if (dto.nit !== undefined) dto = { ...dto, nit: normalizarNit(dto.nit) };
    if (dto.nit) await this.exigirNitLibre(dto.nit, id);
    try {
      const [row] = await this.db.db
        .update(clientes)
        .set(this.coerceDecimales(dto))
        .where(eq(clientes.id, id))
        .returning();
      return row;
    } catch (e) {
      throw errorPorNitDuplicadoPg(e);
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    const [row] = await this.db.db
      .update(clientes)
      .set({ activo: false })
      .where(eq(clientes.id, id))
      .returning();
    return row;
  }

  /** Clientes desactivados, para poder reactivarlos (sólo admin). */
  findInactivos() {
    return this.db.db
      .select()
      .from(clientes)
      .where(eq(clientes.activo, false))
      .orderBy(asc(clientes.nombre));
  }

  /**
   * Deshace `remove`: vuelve a listarse con sus vehículos, pilotos, saldo e
   * historial, que nunca se borraron. Reactivar uno activo no cambia nada.
   */
  async reactivar(id: string) {
    const [row] = await this.db.db
      .update(clientes)
      .set({ activo: true })
      .where(eq(clientes.id, id))
      .returning();
    if (!row) throw new NotFoundException("Cliente no encontrado");
    return row;
  }
}
