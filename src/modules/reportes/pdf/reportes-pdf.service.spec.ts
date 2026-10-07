// src/modules/reportes/pdf/reportes-pdf.service.spec.ts
import { ForbiddenException } from "@nestjs/common";
import puppeteer from "puppeteer";
import { esperarRechazo } from "../../../../test/unit/esperar-error";
import { ReportesPdfService } from "./reportes-pdf.service";

type PuppeteerMock = {
  __paginas: {
    jsHabilitado: boolean;
    interceptacionActiva: boolean;
    eventos: string[];
    html: string | null;
  }[];
  __limpiarPaginas: () => void;
};
const mock = puppeteer as unknown as PuppeteerMock;
const paginas = mock.__paginas;

const CLIENTE_TOKEN = "11111111-1111-1111-1111-111111111111";
const CLIENTE_DTO = "22222222-2222-2222-2222-222222222222";

function armar() {
  const reportes = {
    resumen: jest.fn().mockResolvedValue({
      totales: { total_galones: "1", total_monto: "2", total_despachos: 1 },
      por_tipo_combustible: [],
      por_gasolinera: [],
    }),
    consumoPorVehiculo: jest.fn().mockResolvedValue([]),
    consumoPorPiloto: jest.fn().mockResolvedValue([]),
  };
  const s = new ReportesPdfService({} as any, reportes as any);
  const fetchDespachos = jest
    .spyOn(s as any, "fetchDespachos")
    .mockResolvedValue({ rows: [], total: 0 });
  return { s, reportes, fetchDespachos };
}

describe("ReportesPdfService.generarPdf", () => {
  beforeEach(() => mock.__limpiarPaginas());
  afterEach(() => jest.restoreAllMocks());

  it("un cliente sin empresa recibe 403 sin consultar ni abrir el navegador", async () => {
    const { s, reportes, fetchDespachos } = armar();
    const launch = jest.spyOn(puppeteer, "launch");
    launch.mockClear();

    await esperarRechazo(
      s.generarPdf({}, { rol: "cliente", cliente_id: null }),
      ForbiddenException,
      "Cliente sin empresa asignada",
    );

    expect(reportes.resumen).not.toHaveBeenCalled();
    expect(fetchDespachos).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it("el cliente_id del token pisa el del DTO", async () => {
    const { s, reportes, fetchDespachos } = armar();
    await s.generarPdf(
      { filtros: { cliente_id: CLIENTE_DTO } },
      { rol: "cliente", cliente_id: CLIENTE_TOKEN },
    );
    expect(reportes.resumen).toHaveBeenCalledWith(
      expect.objectContaining({ cliente_id: CLIENTE_TOKEN }),
    );
    expect(fetchDespachos).toHaveBeenCalledWith(
      expect.objectContaining({ cliente_id: CLIENTE_TOKEN }),
    );
  });

  it("el admin respeta el cliente_id del DTO", async () => {
    const { s, reportes, fetchDespachos } = armar();
    await s.generarPdf(
      { filtros: { cliente_id: CLIENTE_DTO } },
      { rol: "admin" },
    );
    expect(reportes.resumen).toHaveBeenCalledWith(
      expect.objectContaining({ cliente_id: CLIENTE_DTO }),
    );
    expect(fetchDespachos).toHaveBeenCalledWith(
      expect.objectContaining({ cliente_id: CLIENTE_DTO }),
    );
  });

  it("sin fechas el período es «Todos los períodos»", async () => {
    const { s } = armar();
    const pdf = await s.generarPdf({}, { rol: "admin" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(paginas[0].html).toContain("Todos los períodos");
  });
});
