// src/modules/usuarios/usuarios.reglas.spec.ts
import { BadRequestException } from "@nestjs/common";
import { esperarError } from "../../../test/unit/esperar-error";
import {
  clienteIdResultante,
  debeEnviarEnlaceDeAlta,
  exigirEmpresaSiEsCliente,
  exigirNoRegistrado,
  identificadoresDeAlta,
  normalizarCambios,
} from "./usuarios.reglas";

describe("identificadoresDeAlta", () => {
  it("baja el correo a minúsculas y deja el teléfono en null", () => {
    expect(identificadoresDeAlta({ email: "Ana@X.COM" })).toEqual({
      email: "ana@x.com",
      telefono: null,
    });
  });

  it("recorta el teléfono", () => {
    expect(identificadoresDeAlta({ telefono: " 5555-1234 " })).toEqual({
      email: null,
      telefono: "5555-1234",
    });
  });

  it.each([{}, { email: "", telefono: "" }, { email: null, telefono: null }])(
    "rechaza con 400 sin ningún identificador (%j)",
    (datos) => {
      esperarError(
        () => identificadoresDeAlta(datos),
        BadRequestException,
        "Debe indicar un correo o un número de teléfono",
      );
    },
  );
});

describe("hallazgos de identificadoresDeAlta", () => {
  // HALLAZGO H6: "   " es truthy, se recorta a "" y se devuelve "" en vez de
  // null. En `create` la comprobación de unicidad vive dentro de
  // `if (telefono)` y "" es falsy, así que no corre `exigirNoRegistrado`: el
  // segundo alta con "" llega al INSERT y choca con `telefono UNIQUE`, y el
  // servicio no captura el 23505 (error de BD sin mensaje en español; 500
  // probable, no verificado). En `update` no hay comprobación de unicidad.
  it('HALLAZGO H6: un teléfono de sólo espacios con correo da telefono "" (no null)', () => {
    expect(identificadoresDeAlta({ email: "a@b.c", telefono: "   " })).toEqual({
      email: "a@b.c",
      telefono: "",
    });
  });
});

describe("exigirEmpresaSiEsCliente", () => {
  it.each([undefined, null, ""])(
    "rechaza con 400 a un cliente sin empresa (%p)",
    (clienteId) => {
      esperarError(
        () => exigirEmpresaSiEsCliente("cliente", clienteId),
        BadRequestException,
        "Un usuario cliente debe tener una empresa (cliente_id) asignada",
      );
    },
  );

  it("deja pasar al cliente con empresa", () => {
    expect(() => exigirEmpresaSiEsCliente("cliente", "c-1")).not.toThrow();
  });

  it("deja pasar al admin sin empresa", () => {
    expect(() => exigirEmpresaSiEsCliente("admin", null)).not.toThrow();
  });

  it("deja pasar cuando el rol es undefined", () => {
    expect(() => exigirEmpresaSiEsCliente(undefined, null)).not.toThrow();
  });
});

describe("exigirNoRegistrado", () => {
  it("rechaza con 400 un email ya registrado", () => {
    esperarError(
      () => exigirNoRegistrado({ id: "u-1" }, "email"),
      BadRequestException,
      "El email ya está registrado",
    );
  });

  it("rechaza con 400 un teléfono ya registrado", () => {
    esperarError(
      () => exigirNoRegistrado({ id: "u-1" }, "teléfono"),
      BadRequestException,
      "El teléfono ya está registrado",
    );
  });

  it("deja pasar cuando no hay fila", () => {
    expect(() => exigirNoRegistrado(undefined, "email")).not.toThrow();
  });
});

describe("normalizarCambios", () => {
  it("baja el correo a minúsculas y recorta el teléfono", () => {
    expect(
      normalizarCambios({ email: "Ana@X.COM", telefono: " 5555-1234 " }),
    ).toEqual({ email: "ana@x.com", telefono: "5555-1234" });
  });

  it("sin email no agrega la clave", () => {
    const r = normalizarCambios({ nombre: "Ana" });
    expect(r).toEqual({ nombre: "Ana" });
    expect("email" in r).toBe(false);
    expect("telefono" in r).toBe(false);
  });

  it("no muta la entrada", () => {
    const entrada = { email: "Ana@X.COM", telefono: " 1 " };
    normalizarCambios(entrada);
    expect(entrada).toEqual({ email: "Ana@X.COM", telefono: " 1 " });
  });
});

describe("clienteIdResultante", () => {
  const actual = { cliente_id: "c-actual" };

  it("sin la clave devuelve la empresa actual", () => {
    expect(clienteIdResultante({}, actual)).toBe("c-actual");
  });

  it("cliente_id presente pero undefined (lo que deja el pipe) conserva la empresa actual", () => {
    expect(clienteIdResultante({ cliente_id: undefined }, actual)).toBe(
      "c-actual",
    );
  });

  it("cliente_id null cuenta: quitar la empresa", () => {
    expect(clienteIdResultante({ cliente_id: null }, actual)).toBeNull();
  });

  it("otro id devuelve ese id", () => {
    expect(clienteIdResultante({ cliente_id: "c-2" }, actual)).toBe("c-2");
  });
});

describe("debeEnviarEnlaceDeAlta", () => {
  it("un cliente con correo recibe el enlace", () => {
    expect(debeEnviarEnlaceDeAlta({ rol: "cliente", email: "a@x.com" })).toBe(
      true,
    );
  });

  it("un cliente sin correo no", () => {
    expect(debeEnviarEnlaceDeAlta({ rol: "cliente", email: null })).toBe(false);
  });

  it("un admin no", () => {
    expect(debeEnviarEnlaceDeAlta({ rol: "admin", email: "a@x.com" })).toBe(
      false,
    );
  });
});
