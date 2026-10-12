import { codigoPg, esViolacionUnica, restriccionPg } from "./errores-pg.reglas";

describe("codigoPg", () => {
  it("lee el code de un error de node-postgres", () => {
    expect(codigoPg({ code: "23505" })).toBe("23505");
  });

  it("lee el code del cause cuando drizzle envuelve el error", () => {
    const envuelto = new Error("Failed query");
    Object.assign(envuelto, { cause: { code: "23505" } });
    expect(codigoPg(envuelto)).toBe("23505");
  });

  it("devuelve undefined si no hay code en ningún nivel", () => {
    expect(codigoPg(new Error("x"))).toBeUndefined();
    expect(codigoPg({ code: 42 })).toBeUndefined();
  });

  it("devuelve undefined para valores que no son objetos", () => {
    expect(codigoPg(undefined)).toBeUndefined();
    expect(codigoPg(null)).toBeUndefined();
    expect(codigoPg("23505")).toBeUndefined();
  });
});

describe("esViolacionUnica", () => {
  it("es true sólo para 23505, directo o envuelto", () => {
    expect(esViolacionUnica({ code: "23505" })).toBe(true);
    expect(esViolacionUnica({ cause: { code: "23505" } })).toBe(true);
    expect(esViolacionUnica({ code: "23503" })).toBe(false);
    expect(esViolacionUnica(undefined)).toBe(false);
  });
});

describe("restriccionPg", () => {
  it("lee el constraint de un error de node-postgres", () => {
    expect(restriccionPg({ code: "23505", constraint: "un_idx" })).toBe(
      "un_idx",
    );
  });

  it("lee el constraint del cause cuando drizzle envuelve el error", () => {
    const envuelto = new Error("Failed query");
    Object.assign(envuelto, {
      cause: { code: "23505", constraint: "un_idx" },
    });
    expect(restriccionPg(envuelto)).toBe("un_idx");
  });

  it("devuelve undefined si no hay constraint en ningún nivel", () => {
    expect(restriccionPg(new Error("x"))).toBeUndefined();
    expect(restriccionPg({ constraint: 42 })).toBeUndefined();
  });

  it("devuelve undefined para valores que no son objetos", () => {
    expect(restriccionPg(undefined)).toBeUndefined();
    expect(restriccionPg(null)).toBeUndefined();
    expect(restriccionPg("un_idx")).toBeUndefined();
  });
});
