import { armarRecordatorio } from "./recordatorio.mensaje";

const base = {
  gasolinera: "La Estación Morales",
  turno: "tarde" as const,
  horaInicio: "14:00",
  frontendUrl: "https://app.example",
  rol: "jefe_pista" as const,
};

describe("armarRecordatorio", () => {
  it("asunto con turno, gasolinera y hora", () => {
    const m = armarRecordatorio({ ...base, precios: [] });
    expect(m.asunto).toBe(
      "Turno Tarde en La Estación Morales empieza a las 14:00: revisa los precios",
    );
  });

  it("lista los precios con nombre legible y formato Q", () => {
    const m = armarRecordatorio({
      ...base,
      precios: [
        { tipo_combustible: "super", precio_galon: "34.750" },
        { tipo_combustible: "diesel", precio_galon: "30.5" },
      ],
    });
    expect(m.texto).toContain("Súper: Q 34.750");
    expect(m.texto).toContain("Diésel: Q 30.500");
    expect(m.push.body).toContain("Súper Q 34.750");
  });

  it("sin precios lo dice explícitamente", () => {
    const m = armarRecordatorio({ ...base, precios: [] });
    expect(m.texto).toContain(
      "Todavía no hay precios cargados para hoy en La Estación Morales.",
    );
    expect(m.push.body).toContain("Sin precios cargados hoy");
  });

  it("enlace según el rol", () => {
    expect(armarRecordatorio({ ...base, precios: [] }).push.url).toBe("/jefe");
    expect(
      armarRecordatorio({ ...base, rol: "admin", precios: [] }).push.url,
    ).toBe("/admin/precios");
    expect(armarRecordatorio({ ...base, precios: [] }).html).toContain(
      'href="https://app.example/jefe"',
    );
  });

  it("escapa el HTML del nombre de la gasolinera", () => {
    const m = armarRecordatorio({
      ...base,
      gasolinera: "<script>x</script>",
      precios: [],
    });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
  });
});
