// src/modules/despachos/vales-pdf.service.spec.ts
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import puppeteer from "puppeteer";
import { esperarRechazo } from "../../../test/unit/esperar-error";
import {
  espiarPrivado,
  usuarioDePrueba,
  vacio,
} from "../../../test/unit/dobles";
import type {
  StorageObject,
  StorageService,
} from "../../storage/storage.service";
import { ValesPdfService } from "./vales-pdf.service";

type PuppeteerMock = {
  __paginas: { html: string | null; opcionesPdf: unknown }[];
  __limpiarPaginas: () => void;
};
const mock = puppeteer as unknown as PuppeteerMock;
const paginas = mock.__paginas;

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
]);
const ADMIN = usuarioDePrueba({ rol: "admin" });
const ID_1 = "11111111-1111-4111-8111-111111111111";
const ID_2 = "22222222-2222-4222-8222-222222222222";

function fila(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `d-${n}`,
    cliente_id: "c-1",
    serie_vale: "A",
    numero_vale: String(n).padStart(6, "0"),
    correlativo_cliente: n,
    despachado_at: new Date("2026-10-01T15:00:00Z"),
    turno: "manana",
    bomba_numero: 1,
    kilometraje: null,
    galones: "10.000",
    monto_total: "300.000",
    firma_key: `firmas/${n}.png`,
    gasolinera: { nombre: "La Estación Morales", ciudad: "Morales" },
    cliente: { nombre: "Transportes Atlántico", nit: "123" },
    vehiculo: null,
    piloto: null,
    operario: null,
    despachador: "Supervisor",
    ...extra,
  };
}

function armar(
  filas: ReturnType<typeof fila>[],
  get: (key: string) => Promise<StorageObject | null> = () =>
    Promise.resolve({ body: PNG, contentType: "image/png" }),
) {
  const storage = { get: jest.fn(get) };
  const s = new ValesPdfService(vacio(), storage as unknown as StorageService);
  const contar = espiarPrivado(s, "contar").mockResolvedValue(filas.length);
  const leerVales = espiarPrivado(s, "leerVales").mockResolvedValue(filas);
  const leerRenglones = espiarPrivado(s, "leerRenglones").mockResolvedValue(
    filas.map((f) => ({
      despacho_id: f.id,
      renglon: "vehiculo",
      tipo_combustible: "diesel",
      galones: "10.000",
      monto: "300.000",
      precio_galon: "30.000",
    })),
  );
  return { s, storage, contar, leerVales, leerRenglones };
}

function vales(html: string | null): number {
  return (html ?? "").split('<article class="vale">').length - 1;
}

describe("ValesPdfService.generar", () => {
  beforeEach(() => mock.__limpiarPaginas());
  afterEach(() => jest.restoreAllMocks());

  it("devuelve el PDF en carta con un vale por fila", async () => {
    const { s } = armar([fila(1), fila(2), fila(3)]);
    const { pdf } = await s.generar({}, undefined, ADMIN);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(vales(paginas[0].html)).toBe(3);
    expect(paginas[0].opcionesPdf).toEqual(
      expect.objectContaining({ format: "Letter", preferCSSPageSize: true }),
    );
  });

  it("un cliente sin empresa recibe 403 sin consultar ni abrir el navegador", async () => {
    const { s, contar } = armar([fila(1)]);
    const launch = jest.spyOn(puppeteer, "launch");
    launch.mockClear();
    await esperarRechazo(
      s.generar({}, undefined, usuarioDePrueba({ rol: "cliente" })),
      ForbiddenException,
      "Cliente sin empresa asignada",
    );
    expect(contar).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it("un supervisor sin estación recibe 404 sin consultar", async () => {
    const { s, contar } = armar([fila(1)]);
    await esperarRechazo(
      s.generar({}, undefined, usuarioDePrueba({ rol: "supervisor" })),
      NotFoundException,
      "No hay vales con esos filtros",
    );
    expect(contar).not.toHaveBeenCalled();
  });

  it("sin vales responde 404 sin leer filas", async () => {
    const { s, contar, leerVales } = armar([]);
    contar.mockResolvedValue(0);
    await esperarRechazo(
      s.generar({}, undefined, ADMIN),
      NotFoundException,
      "No hay vales con esos filtros",
    );
    expect(leerVales).not.toHaveBeenCalled();
  });

  it("más de 500 vales responde 400 antes de leer filas y firmas", async () => {
    const { s, contar, leerVales, storage } = armar([fila(1)]);
    contar.mockResolvedValue(501);
    await esperarRechazo(
      s.generar({}, undefined, ADMIN),
      BadRequestException,
      "Son 501 vales; acota el período o los filtros (máximo 500 por PDF).",
    );
    expect(leerVales).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("más de 500 ids distintos responde el mismo 400 sin consultar", async () => {
    const { s, contar } = armar([fila(1)]);
    const ids = Array.from(
      { length: 501 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    await esperarRechazo(
      s.generar({}, ids, ADMIN),
      BadRequestException,
      "Son 501 vales; acota el período o los filtros (máximo 500 por PDF).",
    );
    expect(contar).not.toHaveBeenCalled();
  });

  it("los ids repetidos cuentan una sola vez", async () => {
    const { s, contar } = armar([fila(1)]);
    const ids = Array.from({ length: 600 }, () => ID_1);
    await s.generar({}, ids, ADMIN);
    expect(contar).toHaveBeenCalled();
  });

  it("una firma que falla en storage deja ese vale sin firma y el lote sigue", async () => {
    const { s } = armar([fila(1), fila(2), fila(3)], (key) =>
      key === "firmas/2.png"
        ? Promise.reject(new Error("R2 caído"))
        : Promise.resolve({ body: PNG, contentType: "image/png" }),
    );
    await s.generar({}, undefined, ADMIN);
    const html = paginas[0].html ?? "";
    expect(vales(html)).toBe(3);
    expect(html.split("Firma no disponible").length - 1).toBe(1);
    expect(html.split('<img class="firma"').length - 1).toBe(2);
  });

  it("sin firma_key, firma ausente en storage o bytes que no son PNG → «Firma no disponible»", async () => {
    const { s, storage } = armar(
      [fila(1, { firma_key: null }), fila(2), fila(3)],
      (key) =>
        Promise.resolve(
          key === "firmas/2.png"
            ? null
            : { body: Buffer.from("<svg/>"), contentType: "image/png" },
        ),
    );
    await s.generar({}, undefined, ADMIN);
    const html = paginas[0].html ?? "";
    expect(html.split("Firma no disponible").length - 1).toBe(3);
    expect(storage.get).toHaveBeenCalledTimes(2);
  });

  it("no lee más de 10 firmas a la vez", async () => {
    let enVuelo = 0;
    let maximo = 0;
    const filas = Array.from({ length: 25 }, (_, i) => fila(i + 1));
    const { s, storage } = armar(filas, async () => {
      enVuelo++;
      maximo = Math.max(maximo, enVuelo);
      await new Promise((r) => setTimeout(r, 5));
      enVuelo--;
      return { body: PNG, contentType: "image/png" };
    });
    await s.generar({}, undefined, ADMIN);
    expect(storage.get).toHaveBeenCalledTimes(25);
    expect(maximo).toBe(10);
  });

  it("el precio por galón de cada renglón llega a la plantilla; sin precio, «—»", async () => {
    const { s, leerRenglones } = armar([fila(1)]);
    leerRenglones.mockResolvedValue([
      {
        despacho_id: "d-1",
        renglon: "vehiculo",
        tipo_combustible: "diesel",
        galones: "10.000",
        monto: "300.000",
        precio_galon: "30.000",
      },
      {
        despacho_id: "d-1",
        renglon: "caneca",
        tipo_combustible: "super",
        galones: "1.000",
        monto: "32.000",
        precio_galon: null,
      },
    ]);
    await s.generar({}, undefined, ADMIN);
    const html = paginas[0].html ?? "";
    expect(html).toContain("Q 30.000/gal");
    expect(html).toMatch(
      /CANECAS · GASOLINA SUPER<\/td>[\s\S]*?<td class="n mono">—<\/td>/,
    );
  });

  it("el pie lleva la fecha y hora de Guatemala", async () => {
    jest.useFakeTimers({ now: new Date("2026-10-02T05:30:00Z") });
    try {
      const { s } = armar([fila(1)]);
      await s.generar({}, undefined, ADMIN);
    } finally {
      jest.useRealTimers();
    }
    // 05:30 UTC = 23:30 del día anterior en Guatemala.
    expect(paginas[0].html).toContain(
      "Copia digital — generada el 01/10/2026, 23:30",
    );
  });

  describe("nombre del archivo", () => {
    it("un solo cliente: su nombre y el período", async () => {
      const { s } = armar([fila(1), fila(2)]);
      const { nombre } = await s.generar(
        { fecha_desde: "2026-10-01", fecha_hasta: "2026-10-31" },
        undefined,
        ADMIN,
      );
      expect(nombre).toBe(
        "vales-transportes-atlantico-2026-10-01-a-2026-10-31.pdf",
      );
    });

    it("varios clientes: «todos»", async () => {
      const { s } = armar([
        fila(1),
        fila(2, { cliente_id: "c-2", cliente: { nombre: "Otro", nit: null } }),
      ]);
      const { nombre } = await s.generar({}, undefined, ADMIN);
      expect(nombre).toBe("vales-todos-inicio-a-hoy.pdf");
    });

    it("un solo id pedido: vale-<serie>-<numero>", async () => {
      const { s } = armar([fila(7)]);
      const { nombre } = await s.generar({}, [ID_1, ID_1], ADMIN);
      expect(nombre).toBe("vale-A-000007.pdf");
    });

    it("dos ids pedidos aunque sólo uno quede en alcance: nombre del lote", async () => {
      const { s } = armar([fila(7)]);
      const { nombre } = await s.generar({}, [ID_1, ID_2], ADMIN);
      expect(nombre).toBe("vales-transportes-atlantico-inicio-a-hoy.pdf");
    });
  });
});
