import { opcionesChrome } from "./chrome";

describe("opcionesChrome", () => {
  it("deja el sandbox activo por defecto", () => {
    expect(opcionesChrome(undefined)).toEqual({ headless: true });
  });

  it.each(["false", "1", "TRUE", ""])(
    "deja el sandbox activo con %p",
    (valor) => {
      expect(opcionesChrome(valor).args).toBeUndefined();
    },
  );

  it('sólo "true" lo apaga', () => {
    expect(opcionesChrome("true")).toEqual({
      headless: true,
      args: ["--no-sandbox"],
    });
  });
});
