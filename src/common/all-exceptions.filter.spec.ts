// src/common/all-exceptions.filter.spec.ts
import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  Logger,
} from "@nestjs/common";
import { AllExceptionsFilter } from "./all-exceptions.filter";

describe("AllExceptionsFilter", () => {
  const filtro = new AllExceptionsFilter();
  let error: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let json: jest.Mock;
  let status: jest.Mock;

  const host = () => {
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });
    return {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: "POST", url: "/api/v1/despachos" }),
      }),
    } as unknown as ArgumentsHost;
  };

  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, "error").mockImplementation();
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it("un 400 conserva status y cuerpo, sin log", () => {
    const e = new BadRequestException("Monto inválido");
    filtro.catch(e, host());
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(e.getResponse());
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("un 403 se registra con warn", () => {
    filtro.catch(new ForbiddenException("No"), host());
    expect(status).toHaveBeenCalledWith(403);
    expect(warn).toHaveBeenCalledWith("POST /api/v1/despachos 403");
    expect(error).not.toHaveBeenCalled();
  });

  it("una HttpException 503 se registra con error", () => {
    const e = new HttpException("Caído", 503);
    filtro.catch(e, host());
    expect(status).toHaveBeenCalledWith(503);
    expect(error).toHaveBeenCalledWith("POST /api/v1/despachos", e.stack);
  });

  it("un Error con texto de la base da 500 genérico y el stack va al log", () => {
    const e = new Error('relation "usuarios" does not exist');
    filtro.catch(e, host());
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      message: "Error interno del servidor",
    });
    expect(JSON.stringify(json.mock.calls)).not.toContain("usuarios");
    expect(error).toHaveBeenCalledWith("POST /api/v1/despachos", e.stack);
  });

  it("un string lanzado también da 500", () => {
    filtro.catch("boom", host());
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      message: "Error interno del servidor",
    });
    expect(error).toHaveBeenCalledWith("POST /api/v1/despachos", "boom");
  });
});
