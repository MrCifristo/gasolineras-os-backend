// src/modules/despachos/despachos-excel.service.spec.ts
import ExcelJS from "exceljs";
import { DespachosExcelService } from "./despachos-excel.service";

const fila = (parcial: Record<string, unknown> = {}) => ({
  id: "d1",
  numero_vale: "100",
  serie_vale: "A",
  despachado_at: new Date("2026-10-08T03:00:00Z"),
  turno: "tarde",
  bomba_numero: 1,
  galones: "10.000",
  monto_total: "50.00",
  kilometraje: null,
  gasolinera: "La Estación Morales",
  cliente: "Distribuidora Caribe",
  placa: "P-123ABC",
  marca: "Toyota",
  modelo: "Hilux",
  piloto: "Juan Pérez",
  codigo_piloto: "J1",
  operario: "Luis",
  tipo_combustible: "diesel",
  precio_galon: "5.000",
  ...parcial,
});

async function exportar(
  rows: unknown[],
  renglones: Map<string, string> = new Map(),
  filtros: Record<string, unknown> = {},
) {
  const s = new DespachosExcelService({} as any);
  jest.spyOn(s as any, "fetchRows").mockResolvedValue(rows);
  jest.spyOn(s as any, "fetchRenglones").mockResolvedValue(renglones);
  const buf = await s.exportXlsx(filtros, { rol: "admin" });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  return wb;
}

describe("DespachosExcelService", () => {
  afterEach(() => jest.restoreAllMocks());

  it("un vale sólo de canecas aparece sin placa ni piloto y con sus renglones", async () => {
    const wb = await exportar(
      [
        fila({
          placa: null,
          piloto: null,
          codigo_piloto: null,
          marca: null,
          modelo: null,
          tipo_combustible: null,
          precio_galon: null,
        }),
      ],
      new Map([["d1", "caneca diesel 5.000 gal"]]),
    );
    const ws = wb.getWorksheet("Despachos")!;
    expect(ws.getRow(4).getCell(1).value).toBe("100");
    expect(ws.getRow(4).getCell(9).value).toBeNull();
    expect(ws.getRow(4).getCell(12).value).toBeNull();
    expect(ws.getRow(4).getCell(15).value).toBe("caneca diesel 5.000 gal");
  });

  it("fecha y hora salen en hora de Guatemala (03:00Z es día 7, 21 h)", async () => {
    const wb = await exportar([fila()]);
    const row = wb.getWorksheet("Despachos")!.getRow(4);
    const fecha = row.getCell(3).value as Date;
    const hora = row.getCell(4).value as Date;
    expect(fecha.getUTCDate()).toBe(7);
    expect(hora.getUTCHours()).toBe(21);
  });

  it.each([
    [[fila(), fila({ id: "d2" })], "2 registros"],
    [[fila()], "1 registro"],
  ])("el subtítulo dice «%#»", async (rows, texto) => {
    const wb = await exportar(rows);
    const sub = wb.getWorksheet("Despachos")!.getCell("A2").value as string;
    expect(sub.endsWith(`·   ${texto}`)).toBe(true);
  });

  it("el resumen trae cantidad, galones y monto", async () => {
    const wb = await exportar([
      fila(),
      fila({ id: "d2", galones: "5.500", monto_total: "27.50" }),
    ]);
    const ws = wb.getWorksheet("Resumen")!;
    expect(ws.getCell("B2").value).toBe(2);
    expect(ws.getCell("B3").value).toBeCloseTo(15.5);
    expect(ws.getCell("B4").value).toBeCloseTo(77.5);
  });

  it("los filtros por defecto dicen (todos) o (sin límite)", async () => {
    const ws = (await exportar([])).getWorksheet("Filtros Aplicados")!;
    const valores = [2, 3, 4, 5, 6, 7, 8, 9].map(
      (r) => ws.getCell(`B${r}`).value,
    );
    expect(valores).toEqual([
      "(todos)",
      "(todas)",
      "(todos)",
      "(todos)",
      "(sin límite)",
      "(sin límite)",
      "(todos)",
      "(todos)",
    ]);
  });

  it("cuando vienen, los filtros muestran su valor", async () => {
    const ws = (
      await exportar([], new Map(), {
        cliente_id: "c1",
        fecha_desde: "2026-10-01",
        turno: "tarde",
      })
    ).getWorksheet("Filtros Aplicados")!;
    expect(ws.getCell("B2").value).toBe("c1");
    expect(ws.getCell("B6").value).toBe("2026-10-01");
    expect(ws.getCell("B8").value).toBe("tarde");
  });

  it("un cliente sin empresa exporta un libro vacío sin tocar la base", async () => {
    // `db` vacío: cualquier acceso a this.db.db lanzaría.
    const s = new DespachosExcelService({} as any);
    const buf = await s.exportXlsx({}, { rol: "cliente", cliente_id: null });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet("Despachos")!;
    expect((ws.getCell("A2").value as string).endsWith("0 registros")).toBe(
      true,
    );
    expect(ws.getRow(4).getCell(1).value).toBeNull();
    expect(wb.getWorksheet("Resumen")!.getCell("B2").value).toBe(0);
  });
});
