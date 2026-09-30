import {
  debeRecordar,
  segmentos,
  seSolapan,
  turnoEnMinuto,
} from "./turnos.util";

// Construye un instante UTC a partir de una hora de Guatemala (UTC−6).
const gt = (fecha: string, hhmm: string) =>
  new Date(new Date(`${fecha}T${hhmm}:00Z`).getTime() + 6 * 3600 * 1000);

describe("segmentos", () => {
  it("un turno normal es un solo segmento", () => {
    expect(segmentos("06:00", "14:00")).toEqual([[360, 840]]);
  });
  it("un turno que cruza la medianoche se parte en dos", () => {
    expect(segmentos("18:00", "06:00")).toEqual([
      [1080, 1440],
      [0, 360],
    ]);
  });
});

describe("seSolapan", () => {
  const t = (hora_inicio: string, hora_fin: string) => ({
    hora_inicio,
    hora_fin,
  });
  it("turnos contiguos no se solapan", () => {
    expect(seSolapan(t("06:00", "14:00"), t("14:00", "22:00"))).toBe(false);
  });
  it("detecta solapamiento simple", () => {
    expect(seSolapan(t("06:00", "14:30"), t("14:00", "22:00"))).toBe(true);
  });
  it("detecta solapamiento con un turno que cruza la medianoche", () => {
    expect(seSolapan(t("05:00", "14:00"), t("18:00", "06:00"))).toBe(true);
  });
  it("24 h repartidas en dos turnos no se solapan", () => {
    expect(seSolapan(t("06:00", "18:00"), t("18:00", "06:00"))).toBe(false);
  });
});

describe("turnoEnMinuto", () => {
  const turnos = [
    { turno: "manana" as const, hora_inicio: "06:00", hora_fin: "14:00" },
    { turno: "tarde" as const, hora_inicio: "14:00", hora_fin: "02:00" },
  ];
  it("el inicio pertenece al turno y el fin no", () => {
    expect(turnoEnMinuto(turnos, 360)?.turno).toBe("manana");
    expect(turnoEnMinuto(turnos, 840)?.turno).toBe("tarde");
  });
  it("después de la medianoche sigue el turno que la cruza", () => {
    expect(turnoEnMinuto(turnos, 60)?.turno).toBe("tarde");
  });
  it("fuera de todo turno devuelve null", () => {
    expect(turnoEnMinuto(turnos, 180)).toBeNull();
  });
});

describe("debeRecordar", () => {
  it("dispara dentro de los 30 minutos previos", () => {
    expect(debeRecordar(gt("2026-09-25", "13:45"), "14:00")).toEqual({
      fecha: "2026-09-25",
    });
  });
  it("dispara exactamente 30 minutos antes", () => {
    expect(debeRecordar(gt("2026-09-25", "13:30"), "14:00")).not.toBeNull();
  });
  it("no dispara 31 minutos antes", () => {
    expect(debeRecordar(gt("2026-09-25", "13:29"), "14:00")).toBeNull();
  });
  it("no dispara a la hora de inicio ni después", () => {
    expect(debeRecordar(gt("2026-09-25", "14:00"), "14:00")).toBeNull();
    expect(debeRecordar(gt("2026-09-25", "14:10"), "14:00")).toBeNull();
  });
  it("si el backend levanta a mitad de la ventana, igual dispara", () => {
    expect(debeRecordar(gt("2026-09-25", "13:59"), "14:00")).not.toBeNull();
  });
  it("turno a las 00:15 evaluado a las 23:50: fecha del día siguiente", () => {
    expect(debeRecordar(gt("2026-09-25", "23:50"), "00:15")).toEqual({
      fecha: "2026-09-26",
    });
  });
  it("turno a las 00:00 evaluado a las 23:30 del 31 de diciembre", () => {
    expect(debeRecordar(gt("2026-12-31", "23:30"), "00:00")).toEqual({
      fecha: "2027-01-01",
    });
  });
});
