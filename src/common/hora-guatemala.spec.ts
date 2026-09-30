import {
  ahoraGuatemala,
  aMinutos,
  fechaGuatemala,
  sumarDias,
} from "./hora-guatemala";

describe("hora-guatemala", () => {
  it("a las 05:59 UTC todavía es el día anterior en Guatemala", () => {
    const r = ahoraGuatemala(new Date("2026-09-26T05:59:00Z"));
    expect(r.fecha).toBe("2026-09-25");
    expect(r.minutos).toBe(23 * 60 + 59);
  });

  it("a las 06:00 UTC ya es medianoche del día siguiente en Guatemala", () => {
    const r = ahoraGuatemala(new Date("2026-09-26T06:00:00Z"));
    expect(r.fecha).toBe("2026-09-26");
    expect(r.minutos).toBe(0);
  });

  it("de 18:00 a 23:59 GT la fecha GT difiere de la UTC (bug H9)", () => {
    // 20:00 GT del 25 = 02:00 UTC del 26
    const ahora = new Date("2026-09-26T02:00:00Z");
    expect(ahora.toISOString().slice(0, 10)).toBe("2026-09-26");
    expect(fechaGuatemala(ahora)).toBe("2026-09-25");
  });

  it("diaSemana usa el calendario de Guatemala", () => {
    // 2026-09-27 es domingo; a las 03:00 UTC del 27 en GT sigue siendo sábado 26
    expect(ahoraGuatemala(new Date("2026-09-27T03:00:00Z")).diaSemana).toBe(6);
  });

  it("sumarDias cruza fin de mes y de año", () => {
    expect(sumarDias("2026-09-30", 1)).toBe("2026-10-01");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("aMinutos acepta HH:mm y HH:mm:ss", () => {
    expect(aMinutos("06:30")).toBe(390);
    expect(aMinutos("23:59:00")).toBe(1439);
  });
});
