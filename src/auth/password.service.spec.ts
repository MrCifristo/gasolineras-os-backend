// src/auth/password.service.spec.ts
// Argon2 real (19 MiB por hash): cada hash tarda decenas de ms.
import { PasswordService } from "./password.service";

describe("PasswordService", () => {
  const s = new PasswordService();

  it("el hash es Argon2id con m=19456,t=2,p=1", async () => {
    const h = await s.hashear("Secreta#2026");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(h).toContain("m=19456,t=2,p=1");
  });

  it("la contraseña correcta verifica y la incorrecta no", async () => {
    const h = await s.hashear("Secreta#2026");
    await expect(s.verificar(h, "Secreta#2026")).resolves.toBe(true);
    await expect(s.verificar(h, "otra")).resolves.toBe(false);
  });

  it("un hash corrupto da false, sin lanzar", async () => {
    await expect(s.verificar("no-es-un-hash", "x")).resolves.toBe(false);
  });

  it("dos hashes de la misma contraseña difieren (sal aleatoria)", async () => {
    const [a, b] = await Promise.all([s.hashear("igual"), s.hashear("igual")]);
    expect(a).not.toBe(b);
  });

  it("la temporal tiene 14 caracteres por defecto", () => {
    expect(s.generarTemporal()).toHaveLength(14);
  });

  it("la temporal respeta el largo pedido", () => {
    expect(s.generarTemporal(6)).toHaveLength(6);
    expect(s.generarTemporal(40)).toHaveLength(40);
  });

  it("50 temporales de 40 caracteres no traen caracteres ambiguos", () => {
    for (let i = 0; i < 50; i++) {
      expect(s.generarTemporal(40)).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]+$/);
    }
  });
});
