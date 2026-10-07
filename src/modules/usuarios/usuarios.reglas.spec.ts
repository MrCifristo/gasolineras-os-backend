// src/modules/usuarios/usuarios.reglas.spec.ts
import { BadRequestException } from "@nestjs/common";
import { esperarError } from "../../../test/unit/esperar-error";
import {
  clienteIdResultante,
  debeEnviarEnlaceDeAlta,
  exigirEmpresaSiEsCliente,
  exigirNoRegistrado,
  exigirIdentificadorResultante,
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

describe("identificadoresDeAlta con identificadores en blanco", () => {
  it("un teléfono de sólo espacios con correo da telefono null", () => {
    expect(identificadoresDeAlta({ email: "a@b.c", telefono: "   " })).toEqual({
      email: "a@b.c",
      telefono: null,
    });
  });

  it("un correo de sólo espacios con teléfono da email null", () => {
    expect(identificadoresDeAlta({ email: "  ", telefono: "5555" })).toEqual({
      email: null,
      telefono: "5555",
    });
  });

  it("recorta y baja a minúsculas el correo", () => {
    expect(
      identificadoresDeAlta({ email: "  A@B.C ", telefono: null }),
    ).toEqual({ email: "a@b.c", telefono: null });
  });

  it("ambos en blanco rechaza con 400", () => {
    esperarError(
      () => identificadoresDeAlta({ email: " ", telefono: "  " }),
      BadRequestException,
      "Debe indicar un correo o un número de teléfono",
    );
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

  it("un correo o teléfono en blanco queda en null", () => {
    expect(normalizarCambios({ email: "  ", telefono: "" })).toEqual({
      email: null,
      telefono: null,
    });
  });

  it("claves presentes con undefined siguen sin valor", () => {
    const r = normalizarCambios({ email: undefined, telefono: undefined });
    expect(r.email).toBeUndefined();
    expect(r.telefono).toBeUndefined();
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

describe("exigirIdentificadorResultante", () => {
  const soloTelefono = { email: null, telefono: "5555" };
  const soloCorreo = { email: "a@b.c", telefono: null };
  const MSG = "Debe indicar un correo o un número de teléfono";

  it("sin cambios de identificadores conserva los actuales", () => {
    expect(() => exigirIdentificadorResultante({}, soloTelefono)).not.toThrow();
  });

  it("claves presentes con undefined cuentan como ausentes", () => {
    expect(() =>
      exigirIdentificadorResultante(
        { email: undefined, telefono: undefined },
        soloTelefono,
      ),
    ).not.toThrow();
  });

  it("vaciar el único identificador: 400", () => {
    esperarError(
      () => exigirIdentificadorResultante({ telefono: null }, soloTelefono),
      BadRequestException,
      MSG,
    );
    esperarError(
      () => exigirIdentificadorResultante({ email: null }, soloCorreo),
      BadRequestException,
      MSG,
    );
  });

  it("vaciar uno estando el otro presente pasa", () => {
    expect(() =>
      exigirIdentificadorResultante(
        { telefono: null },
        { email: "a@b.c", telefono: "5555" },
      ),
    ).not.toThrow();
  });

  it("agregar un identificador a quien solo tenía otro pasa", () => {
    expect(() =>
      exigirIdentificadorResultante(
        { email: "x@y.z", telefono: null },
        soloTelefono,
      ),
    ).not.toThrow();
  });
});
