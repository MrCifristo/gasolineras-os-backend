import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { UsuarioSesion } from "../../auth/usuario-actual";
import { renderizarPdf } from "../../common/render-pdf";
import { DbService } from "../../db/db.service";
import {
  clientes,
  despachoDetalles,
  despachos,
  gasolineras,
  operarios,
  pilotos,
  preciosCombustible,
  usuarios,
  vehiculos,
} from "../../db/schema";
import { StorageService } from "../../storage/storage.service";
import {
  condicionesDespachos,
  type DespachoFilters,
} from "./despachos.condiciones";
import {
  exigirTopeVales,
  MAX_VALES_POR_PDF,
  nombreArchivoVales,
} from "./vales-pdf.reglas";
import { buildValesHtml, type ValePdf } from "./vales-pdf.template";

/** Lecturas de firma a R2 en vuelo a la vez: un lote de 500 no abre 500 sockets. */
const FIRMAS_EN_PARALELO = 10;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type FilaRenglon = Awaited<
  ReturnType<ValesPdfService["leerRenglones"]>
>[number];

/** `fn` sobre cada elemento, con a lo sumo `limite` llamadas en vuelo; conserva el orden. */
async function mapearConLimite<T, R>(
  items: T[],
  limite: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const resultados = new Array<R>(items.length);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      resultados[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limite, items.length) }, trabajador),
  );
  return resultados;
}

/**
 * PDF de vales (carta, 4 por hoja): copia digital para el archivo contable y
 * la conciliación del cliente. Alcance idéntico al listado de despachos
 * (`condicionesDespachos`); un id fuera de alcance simplemente no aparece.
 */
@Injectable()
export class ValesPdfService {
  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
  ) {}

  async generar(
    filtros: Omit<DespachoFilters, "page" | "limit">,
    ids: string[] | undefined,
    usuario: UsuarioSesion,
  ): Promise<{ pdf: Buffer; nombre: string }> {
    const condiciones = condicionesDespachos(filtros, usuario);
    if (!condiciones) {
      // Igual que reportes: el cliente sin empresa sabe por qué no ve nada.
      if (usuario.rol === "cliente") {
        throw new ForbiddenException("Cliente sin empresa asignada");
      }
      throw new NotFoundException("No hay vales con esos filtros");
    }

    const idsUnicos = ids ? [...new Set(ids)] : undefined;
    if (idsUnicos) {
      // Una lista enorme se corta acá, sin llegar al IN de la consulta.
      if (idsUnicos.length > MAX_VALES_POR_PDF) {
        exigirTopeVales(idsUnicos.length);
      }
      condiciones.push(inArray(despachos.id, idsUnicos));
    }
    const where = condiciones.length ? and(...condiciones) : undefined;

    // El tope va antes de leer filas y firmas: un período enorme no debe
    // cargar miles de vales para después rechazarlos.
    exigirTopeVales(await this.contar(where));

    const filas = await this.leerVales(where);
    const [renglones, firmas] = await Promise.all([
      this.leerRenglones(filas.map((f) => f.id)),
      mapearConLimite(filas, FIRMAS_EN_PARALELO, (f) =>
        this.leerFirma(f.firma_key),
      ),
    ]);

    const porDespacho = new Map<string, FilaRenglon[]>();
    for (const r of renglones) {
      const lista = porDespacho.get(r.despacho_id) ?? [];
      lista.push(r);
      porDespacho.set(r.despacho_id, lista);
    }

    const vales: ValePdf[] = filas.map((f, i) => ({
      serie_vale: f.serie_vale,
      numero_vale: f.numero_vale,
      correlativo_cliente: f.correlativo_cliente,
      despachado_at: f.despachado_at ?? "",
      turno: f.turno,
      bomba_numero: f.bomba_numero,
      gasolinera: f.gasolinera,
      cliente: f.cliente,
      vehiculo: f.vehiculo,
      piloto: f.piloto,
      kilometraje: f.kilometraje,
      renglones: (porDespacho.get(f.id) ?? []).map((r) => ({
        renglon: r.renglon,
        tipo_combustible: r.tipo_combustible,
        galones: r.galones,
        precio_galon: r.precio_galon,
        monto: r.monto,
      })),
      monto_total: f.monto_total,
      galones: f.galones,
      operario: f.operario,
      despachador: f.despachador,
      firma: firmas[i],
    }));

    const html = buildValesHtml({ vales, generadoEn: fechaHoraGuatemala() });
    const pdf = await renderizarPdf(html, "Letter");

    const unSoloCliente = new Set(filas.map((f) => f.cliente_id)).size === 1;
    const nombre = nombreArchivoVales({
      cliente: unSoloCliente ? filas[0].cliente.nombre : null,
      desde: filtros.fecha_desde,
      hasta: filtros.fecha_hasta,
      unVale:
        idsUnicos?.length === 1
          ? { serie: filas[0].serie_vale, numero: filas[0].numero_vale }
          : undefined,
    });
    return { pdf, nombre };
  }

  private async contar(where: SQL | undefined): Promise<number> {
    const [{ total }] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(despachos)
      .where(where);
    return total;
  }

  private leerVales(where: SQL | undefined) {
    return (
      this.db.db
        .select({
          id: despachos.id,
          cliente_id: despachos.cliente_id,
          serie_vale: despachos.serie_vale,
          numero_vale: despachos.numero_vale,
          correlativo_cliente: despachos.correlativo_cliente,
          despachado_at: despachos.despachado_at,
          turno: despachos.turno,
          bomba_numero: despachos.bomba_numero,
          kilometraje: despachos.kilometraje,
          galones: despachos.galones,
          monto_total: despachos.monto_total,
          firma_key: despachos.firma_key,
          gasolinera: {
            nombre: gasolineras.nombre,
            ciudad: gasolineras.ciudad,
          },
          cliente: { nombre: clientes.nombre, nit: clientes.nit },
          vehiculo: {
            placa: vehiculos.placa,
            marca: vehiculos.marca,
            modelo: vehiculos.modelo,
          },
          piloto: { nombre_completo: pilotos.nombre_completo },
          operario: operarios.nombre,
          despachador: usuarios.nombre,
        })
        .from(despachos)
        // inner: gasolinera_id y cliente_id son NOT NULL con FK, así que no
        // descartan nada y dejan los tipos sin null (como en findOne).
        .innerJoin(gasolineras, eq(despachos.gasolinera_id, gasolineras.id))
        .innerJoin(clientes, eq(despachos.cliente_id, clientes.id))
        // left: un vale sólo de canecas no tiene vehículo ni piloto, los
        // anteriores a la Fase 1 no tienen operario.
        .leftJoin(vehiculos, eq(despachos.vehiculo_id, vehiculos.id))
        .leftJoin(pilotos, eq(despachos.piloto_id, pilotos.id))
        .leftJoin(operarios, eq(despachos.operario_id, operarios.id))
        .leftJoin(usuarios, eq(despachos.despachador_id, usuarios.id))
        .where(where)
        .orderBy(
          asc(clientes.nombre),
          asc(despachos.cliente_id),
          asc(despachos.correlativo_cliente),
        )
    );
  }

  /** Todos los renglones del lote en una consulta, con el precio de cada uno. */
  private leerRenglones(despachoIds: string[]) {
    return (
      this.db.db
        .select({
          despacho_id: despachoDetalles.despacho_id,
          renglon: despachoDetalles.renglon,
          tipo_combustible: despachoDetalles.tipo_combustible,
          galones: despachoDetalles.galones,
          monto: despachoDetalles.monto,
          // despacho_detalles guarda el precio_id, no el precio.
          precio_galon: preciosCombustible.precio_galon,
        })
        .from(despachoDetalles)
        .leftJoin(
          preciosCombustible,
          eq(despachoDetalles.precio_id, preciosCombustible.id),
        )
        .where(inArray(despachoDetalles.despacho_id, despachoIds))
        // Vehículo, canecas, toneles; el id desempata dentro del mismo tipo.
        .orderBy(
          sql`CASE ${despachoDetalles.renglon} WHEN 'vehiculo' THEN 0 WHEN 'caneca' THEN 1 ELSE 2 END`,
          asc(despachoDetalles.id),
        )
    );
  }

  /**
   * La firma como data-URL PNG, o null si el vale no tiene, no está en el
   * storage, falla la lectura o los bytes no son un PNG: ese vale dice
   * "Firma no disponible" y el lote sigue (a diferencia de la reimpresión de
   * la bomba, que no imprime sin firma).
   */
  private async leerFirma(key: string | null): Promise<string | null> {
    if (!key) return null;
    try {
      const obj = await this.storage.get(key);
      if (!obj || !obj.body.subarray(0, 8).equals(PNG_MAGIC)) return null;
      return `data:image/png;base64,${obj.body.toString("base64")}`;
    } catch {
      return null;
    }
  }
}

function fechaHoraGuatemala(): string {
  return new Date().toLocaleString("es-GT", {
    timeZone: "America/Guatemala",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}
