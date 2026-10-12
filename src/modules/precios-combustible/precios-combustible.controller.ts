import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { Auth } from "../../auth/roles.decorator";
import { PreciosCombustibleService } from "./precios-combustible.service";
import { CreatePrecioDto } from "./dto/create-precio.dto";
import { UpdatePrecioDto } from "./dto/update-precio.dto";
import { UsuarioActual, type UsuarioSesion } from "../../auth/usuario-actual";

@ApiTags("precios-combustible")
@ApiBearerAuth("JWT")
@Controller("precios-combustible")
export class PreciosCombustibleController {
  constructor(private readonly service: PreciosCombustibleService) {}

  @Get()
  @Auth("admin", "supervisor", "jefe_pista", "cliente")
  @ApiOperation({
    summary: "Listar precios, filtrable por gasolinera_id y fecha",
  })
  @ApiQuery({ name: "gasolinera_id", required: false })
  @ApiQuery({ name: "fecha", required: false, example: "2026-05-21" })
  findAll(
    @Query("gasolinera_id", new ParseUUIDPipe({ optional: true }))
    gasolineraId?: string,
    @Query("fecha") fecha?: string,
  ) {
    return this.service.findAll(gasolineraId, fecha);
  }

  @Get("hoy")
  @Auth("admin", "supervisor", "jefe_pista", "cliente")
  @ApiOperation({
    summary: "Precios de hoy (hora de Guatemala) de una gasolinera",
  })
  @ApiQuery({ name: "gasolinera_id", required: false })
  findHoy(
    @UsuarioActual() usuario: UsuarioSesion,
    @Query("gasolinera_id", new ParseUUIDPipe({ optional: true }))
    gasolineraId?: string,
  ) {
    // El supervisor sólo ve su gasolinera; admin, jefe de pista y cliente eligen.
    const id =
      usuario.rol === "supervisor" ? usuario.gasolinera_id : gasolineraId;
    if (!id) throw new BadRequestException("Falta gasolinera_id");
    return this.service.findHoy(id);
  }

  @Post()
  @Auth("admin", "jefe_pista")
  @ApiOperation({ summary: "Registrar precio del día" })
  create(@Body() dto: CreatePrecioDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @Auth("admin", "jefe_pista")
  @ApiOperation({ summary: "Corregir precio" })
  update(@Param("id") id: string, @Body() dto: UpdatePrecioDto) {
    return this.service.update(id, dto);
  }
}
