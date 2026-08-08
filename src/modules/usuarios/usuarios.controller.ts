import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Auth } from "../../auth/roles.decorator";
import { CreateUsuarioDto } from "./dto/create-usuario.dto";
import { ResetPasswordAdminDto } from "./dto/reset-password-admin.dto";
import { UpdateUsuarioDto } from "./dto/update-usuario.dto";
import { UsuariosService } from "./usuarios.service";

@ApiTags("usuarios")
@ApiBearerAuth("JWT")
@Controller("usuarios")
export class UsuariosController {
  constructor(private readonly service: UsuariosService) {}

  @Get()
  @Auth("admin")
  @ApiOperation({ summary: "Listar usuarios activos" })
  findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  @Auth("admin")
  @ApiOperation({ summary: "Obtener usuario por ID" })
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Auth("admin")
  @ApiOperation({
    summary:
      "Crear usuario. Devuelve `password_temporal` en claro una sola vez; no se persiste.",
  })
  create(@Body() dto: CreateUsuarioDto) {
    return this.service.create(dto);
  }

  @Post(":id/reset-password")
  @Auth("admin")
  @ApiOperation({
    summary:
      'Resetear contraseña: "generar" devuelve una temporal, "enlace" manda el correo de recuperación',
  })
  resetPassword(@Param("id") id: string, @Body() dto: ResetPasswordAdminDto) {
    return this.service.resetPassword(id, dto.modo);
  }

  @Patch(":id")
  @Auth("admin")
  @ApiOperation({ summary: "Actualizar usuario" })
  update(@Param("id") id: string, @Body() dto: UpdateUsuarioDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @Auth("admin")
  @ApiOperation({
    summary: "Desactivar usuario (soft delete + revoca sus sesiones)",
  })
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
