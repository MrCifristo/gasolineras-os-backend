import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: process.env.FRONTEND_URL || "http://localhost:3001",
    credentials: true,
  });

  app.setGlobalPrefix("api/v1");

  const config = new DocumentBuilder()
    .setTitle("GasFuel Backend API")
    .setDescription("API para gestión de despachos de combustible")
    .setVersion("1.0")
    .addBearerAuth(
      { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      "JWT",
    )
    .addTag("gasolineras", "Gestión de gasolineras")
    .addTag("clientes", "Gestión de clientes")
    .addTag("vehiculos", "Gestión de vehículos")
    .addTag("pilotos", "Gestión de pilotos")
    .addTag("precios-combustible", "Precios de combustible por gasolinera")
    .addTag("despachos", "Registro de despachos")
    .addTag("reportes", "Reportes y estadísticas")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(process.env.PORT ?? 3000);
  console.log(
    `gasfuel-backend corriendo en puerto ${process.env.PORT ?? 3000}`,
  );
  console.log(
    `Swagger UI disponible en http://localhost:${process.env.PORT ?? 3000}/api/docs`,
  );
}
bootstrap();
