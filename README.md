# SIGEFER - Sistema de Gestión Ferretera (Ferrecentro Nica)

Aplicación web ligera, reactiva y autocontenida desarrollada en **Rust** para el sistema distribuido de ferreterías **Ferrecentro Nica**.

## 🚀 Características

- **Binario estático autocontenido:** Toda la interfaz de usuario (HTML, CSS, JS, SVG) se embebe en tiempo de compilación con `include_str!`. El binario resultante pesa aproximadamente 2.2 MB y no requiere servidores web auxiliares (como Nginx o Apache).
- **Conexión TDS nativa por usuario:** No utiliza un usuario de servicio genérico para la base de datos. Cada sesión web autentica directamente contra la instancia de SQL Server del nodo seleccionado con el login y contraseña del empleado. Las restricciones de seguridad, esquemas, `GRANT`/`DENY` y Row-Level Security (RLS) son validadas por el motor de base de datos.
- **Detección dinámica de perfiles:** Consulta dinámicamente `IS_ROLEMEMBER` para los roles del sistema (`rol_vendedor`, `rol_cajero`, `rol_cxc`, `rol_almacen`, `rol_gerente_sucursal`, `rol_gerente_general`, `rol_auditor`, `db_owner`, `sysadmin`) para renderizar las vistas permitidas.
- **Sesiones en memoria:** Identificadores criptográficos de 256 bits almacenados en memoria con cookies `HttpOnly; SameSite=Strict` y recolección de sesiones inactivas tras 30 minutos.
- **Despliegue ultraligero:** Imagen de contenedor construida `FROM scratch` de ~2.5 MB gestionada mediante Podman Quadlet / systemd.

## 🛠️ Tecnologías

- **Lenguaje:** Rust 2021
- **Framework Web:** [Axum 0.8](https://github.com/tokio-rs/axum)
- **Runtime Asíncrono:** [Tokio](https://tokio.rs/)
- **Driver SQL Server:** [Tiberius 0.12](https://github.com/steffengy/tiberius) (TDS 7.3 con cifrado TLS vía `rustls`)
- **Frontend:** Single Page Application (SPA) nativa en Vanilla JavaScript, HTML5 y CSS3 (tema oscuro).

## 📁 Estructura del Proyecto

```text
.
├── Cargo.toml              # Definición del paquete y dependencias en Rust
├── Cargo.lock              # Bloqueo de versiones reproducibles
├── Containerfile           # Definición del contenedor OCI (FROM scratch)
├── fcn-app.container       # Unidad Quadlet para despliegue con systemd/Podman
├── src/
│   └── main.rs             # Backend completo: rutas, sesiones, API REST y conexión TDS
└── static/
    ├── index.html          # Maquetación de la interfaz SPA y modales
    ├── app.css             # Estilos de la aplicación
    ├── app.js              # Lógica del cliente, enrutamiento (#/) y consumo de endpoints
    └── favicon.svg         # Icono vectorial
```

## ⚙️ Configuración (`SIGEFER_NODOS`)

La aplicación resuelve las instancias de base de datos a través de la variable de entorno `SIGEFER_NODOS`, con el formato:

```ini
SIGEFER_NODOS=CEN=fcn-cen:1433/BD_FCN_Central;ALM=fcn-cen:1433/BD_FCN_Almacen;NOR=fcn-nor:1433/BD_FCN_Norte;SUR=fcn-sur:1433/BD_FCN_Sur;EST=fcn-est:1433/BD_FCN_Este;CORP=fcn-corp:1433/BD_FCN_Corporativa
```

Cada par define el identificador de nodo (`CEN`, `ALM`, `NOR`, `SUR`, `EST`, `CORP`), su hostname/IP, puerto y base de datos correspondiente.

## 📦 Compilación

Para compilar el binario estático compatible con Alpine/Scratch:

```bash
# 1. Agregar el target musl (si no lo tienes instalado)
rustup target add x86_64-unknown-linux-musl

# 2. Compilar en modo release optimizado
cargo build --release --target x86_64-unknown-linux-musl

# El binario estático quedará en:
# target/x86_64-unknown-linux-musl/release/sigefer
```

## 🚢 Despliegue con Podman / Quadlet

1. Copiar el binario compilado y el `Containerfile` al servidor o carpeta de trabajo:
   ```bash
   podman build -t sigefer:latest .
   ```

2. Instalar el archivo Quadlet `fcn-app.container` en `~/.config/containers/systemd/fcn-app.container`.

3. Recargar y levantar el servicio en systemd:
   ```bash
   systemctl --user daemon-reload
   systemctl --user restart fcn-app.service
   ```

La aplicación quedará disponible en el puerto `8080` (ej. `http://localhost:8080`).
