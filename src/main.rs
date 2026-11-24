//! SIGEFER · Fase 20 · Backend de la aplicación (contenedor `fcn-app`).
//!
//! Cada usuario entra con su login de SQL Server: el backend abre una conexión
//! TDS (TLS) al nodo elegido y la mantiene mientras dure la sesión. La app no
//! guarda contraseñas ni tiene cuenta de servicio; los permisos los aplica el motor.

use axum::{
    extract::{FromRequestParts, Path, Request, State},
    http::{header, request::Parts, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, Mutex as StdMutex},
    time::{Duration, Instant},
};
use tiberius::{error::Error as TdsError, AuthMethod, Client, ColumnData, Config, ToSql};
use tokio::{
    net::TcpStream,
    sync::{Mutex, RwLock},
};
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

const COOKIE: &str = "sigefer_sid";
const INACTIVIDAD: Duration = Duration::from_secs(30 * 60);
const NODOS_POR_DEFECTO: &str = "CEN=fcn-cen:1433/BD_FCN_Central;ALM=fcn-cen:1433/BD_FCN_Almacen;NOR=fcn-nor:1433/BD_FCN_Norte;SUR=fcn-sur:1433/BD_FCN_Sur;EST=fcn-est:1433/BD_FCN_Este;CORP=fcn-corp:1433/BD_FCN_Corporativa";

type Tds = Client<Compat<TcpStream>>;
type Param<'a> = &'a dyn ToSql;

/* ------------------------------------------------------------------ */
/* Nodos y sesiones                                                    */
/* ------------------------------------------------------------------ */

#[derive(Clone)]
struct Destino {
    host: String,
    puerto: u16,
    base: String,
}

#[derive(Clone, Copy, PartialEq)]
enum Tipo {
    Sucursal,
    Almacen,
    Corporativo,
}

impl Tipo {
    fn de(nodo: &str) -> Tipo {
        match nodo {
            "ALM" => Tipo::Almacen,
            "CORP" => Tipo::Corporativo,
            _ => Tipo::Sucursal,
        }
    }
    fn nombre(self) -> &'static str {
        match self {
            Tipo::Sucursal => "SUCURSAL",
            Tipo::Almacen => "ALMACEN",
            Tipo::Corporativo => "CORPORATIVO",
        }
    }
}

struct Sesion {
    cliente: Mutex<Tds>,
    tipo: Tipo,
    nodo: String,
    perfil: Value,
    ultimo: StdMutex<Instant>,
}

struct Estado {
    destinos: HashMap<String, Destino>,
    sesiones: RwLock<HashMap<String, Arc<Sesion>>>,
}
type App = Arc<Estado>;

fn leer_nodos(texto: &str) -> HashMap<String, Destino> {
    let mut mapa = HashMap::new();
    for par in texto.split(';').map(str::trim).filter(|p| !p.is_empty()) {
        let Some((clave, resto)) = par.split_once('=') else { continue };
        let Some((hostport, base)) = resto.split_once('/') else { continue };
        let (host, puerto) = match hostport.rsplit_once(':') {
            Some((h, p)) => (h, p.parse().unwrap_or(1433)),
            None => (hostport, 1433),
        };
        mapa.insert(
            clave.trim().to_uppercase(),
            Destino { host: host.into(), puerto, base: base.into() },
        );
    }
    mapa
}

/// Puerto con que el servidor publica cada nodo en su propio equipo.
fn puerto_publicado(nodo: &str) -> u16 {
    match nodo {
        "NOR" => 1434,
        "SUR" => 1435,
        "EST" => 1436,
        "CORP" => 1437,
        _ => 1433,
    }
}

fn nombre_nodo(nodo: &str) -> &'static str {
    match nodo {
        "CEN" => "Sucursal Central",
        "NOR" => "Sucursal Norte",
        "SUR" => "Sucursal Sur",
        "EST" => "Sucursal Este",
        "ALM" => "Almacén Central",
        "CORP" => "Dirección Corporativa",
        _ => "Nodo",
    }
}

async fn conectar(host: &str, puerto: u16, base: &str, usuario: &str, clave: &str) -> Result<Tds, TdsError> {
    let mut cfg = Config::new();
    cfg.host(host);
    cfg.port(puerto);
    cfg.database(base);
    cfg.authentication(AuthMethod::sql_server(usuario, clave));
    cfg.trust_cert();
    cfg.application_name("SIGEFER");
    let tcp = tokio::time::timeout(Duration::from_secs(4), TcpStream::connect(cfg.get_addr()))
        .await
        .map_err(|_| TdsError::from(std::io::Error::from(std::io::ErrorKind::TimedOut)))??;
    tcp.set_nodelay(true)?;
    tokio::time::timeout(Duration::from_secs(10), Client::connect(cfg, tcp.compat_write()))
        .await
        .map_err(|_| TdsError::from(std::io::Error::from(std::io::ErrorKind::TimedOut)))?
}

/* ------------------------------------------------------------------ */
/* Errores                                                             */
/* ------------------------------------------------------------------ */

struct ApiError {
    status: StatusCode,
    mensaje: String,
    cerrar_sesion: bool,
}

impl ApiError {
    fn nuevo(status: StatusCode, mensaje: impl Into<String>) -> Self {
        ApiError { status, mensaje: mensaje.into(), cerrar_sesion: false }
    }
    fn invalido(mensaje: impl Into<String>) -> Self {
        Self::nuevo(StatusCode::BAD_REQUEST, mensaje)
    }
}

impl From<TdsError> for ApiError {
    fn from(e: TdsError) -> Self {
        match e {
            TdsError::Server(t) => {
                // 229/230/262/297/300: permiso denegado; 18456: login fallido; 371/4060: sin acceso a la base.
                let status = match t.code() {
                    229 | 230 | 262 | 297 | 300 | 371 | 4060 => StatusCode::FORBIDDEN,
                    18456 => StatusCode::UNAUTHORIZED,
                    _ => StatusCode::BAD_REQUEST,
                };
                ApiError { status, mensaje: t.message().to_string(), cerrar_sesion: false }
            }
            otro => ApiError {
                status: StatusCode::UNAUTHORIZED,
                mensaje: format!("Se perdió la conexión con el nodo: {otro}"),
                cerrar_sesion: true,
            },
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut r = (self.status, Json(json!({ "error": self.mensaje }))).into_response();
        if self.cerrar_sesion {
            r.headers_mut().insert(header::SET_COOKIE, cookie_borrar());
        }
        r
    }
}

type Res<T> = Result<Json<T>, ApiError>;

fn cookie_borrar() -> HeaderValue {
    HeaderValue::from_str(&format!("{COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")).unwrap()
}

/* ------------------------------------------------------------------ */
/* Consultas                                                           */
/* ------------------------------------------------------------------ */

fn dato(c: ColumnData<'static>) -> Value {
    fn num(f: f64) -> Value {
        serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
    }
    match c {
        ColumnData::U8(v) => v.map(Value::from).unwrap_or(Value::Null),
        ColumnData::I16(v) => v.map(Value::from).unwrap_or(Value::Null),
        ColumnData::I32(v) => v.map(Value::from).unwrap_or(Value::Null),
        ColumnData::I64(v) => v.map(Value::from).unwrap_or(Value::Null),
        ColumnData::F32(v) => v.map(|f| num(f as f64)).unwrap_or(Value::Null),
        ColumnData::F64(v) => v.map(num).unwrap_or(Value::Null),
        ColumnData::Bit(v) => v.map(Value::Bool).unwrap_or(Value::Null),
        ColumnData::String(v) => v.map(|s| Value::String(s.into_owned())).unwrap_or(Value::Null),
        ColumnData::Numeric(v) => v
            .map(|n| num(n.value() as f64 / 10f64.powi(n.scale() as i32)))
            .unwrap_or(Value::Null),
        ColumnData::Binary(v) => v
            .map(|b| Value::String(b.iter().map(|x| format!("{x:02x}")).collect()))
            .unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

impl Sesion {
    fn tocar(&self) {
        *self.ultimo.lock().unwrap() = Instant::now();
    }

    /// Ejecuta una consulta y devuelve las filas del primer resultado como objetos.
    async fn filas(&self, sql: &str, p: &[Param<'_>]) -> Result<Vec<Value>, ApiError> {
        self.tocar();
        let mut cl = self.cliente.lock().await;
        let filas = cl.query(sql, p).await?.into_first_result().await?;
        Ok(filas
            .into_iter()
            .map(|fila| {
                let nombres: Vec<String> = fila.columns().iter().map(|c| c.name().to_string()).collect();
                let mut m = Map::new();
                for (n, d) in nombres.into_iter().zip(fila.into_iter()) {
                    m.insert(n, dato(d));
                }
                Value::Object(m)
            })
            .collect())
    }

    /// Ejecuta una instrucción sin resultado (procedimientos que solo cambian datos).
    async fn ejecutar(&self, sql: &str, p: &[Param<'_>]) -> Result<(), ApiError> {
        self.tocar();
        let mut cl = self.cliente.lock().await;
        cl.execute(sql, p).await?;
        Ok(())
    }

    /// Primera columna de la primera fila (para los parámetros OUTPUT).
    async fn id_de(&self, sql: &str, p: &[Param<'_>]) -> Result<Value, ApiError> {
        let f = self.filas(sql, p).await?;
        Ok(f.first().and_then(|r| r.get("id")).cloned().unwrap_or(Value::Null))
    }
}

/// Extractor: la sesión que corresponde a la cookie de la petición.
struct Ses(Arc<Sesion>);

impl FromRequestParts<App> for Ses {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, app: &App) -> Result<Self, ApiError> {
        let sid = parts
            .headers
            .get(header::COOKIE)
            .and_then(|v| v.to_str().ok())
            .and_then(|c| c.split(';').map(str::trim).find_map(|kv| kv.strip_prefix("sigefer_sid=")))
            .unwrap_or("")
            .to_string();
        let sesion = app.sesiones.read().await.get(&sid).cloned();
        match sesion {
            Some(s) if s.ultimo.lock().unwrap().elapsed() < INACTIVIDAD => Ok(Ses(s)),
            _ => {
                app.sesiones.write().await.remove(&sid);
                Err(ApiError {
                    status: StatusCode::UNAUTHORIZED,
                    mensaje: "La sesión terminó. Inicia sesión de nuevo.".into(),
                    cerrar_sesion: true,
                })
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* Perfil: roles → pantallas y acciones                                */
/* ------------------------------------------------------------------ */

const ROLES: [(&str, &str); 10] = [
    ("sysadmin", "Administrador (sysadmin)"),
    ("db_owner", "DBA (db_owner)"),
    ("rol_gerente_general", "Gerente General"),
    ("rol_auditor", "Auditor"),
    ("rol_gerente_sucursal", "Gerente de Sucursal"),
    ("rol_almacen", "Encargado de Almacén"),
    ("rol_cxc", "Responsable de CxC"),
    ("rol_cajero", "Cajero"),
    ("rol_vendedor", "Vendedor"),
    ("rol_catalogos", "Catálogos"),
];

fn permisos(tipo: Tipo, roles: &[String]) -> (Vec<&'static str>, Vec<&'static str>) {
    let tiene = |r: &str| roles.iter().any(|x| x == r);
    let admin = tiene("sysadmin") || tiene("db_owner");
    let alguno = |rs: &[&str]| admin || rs.iter().any(|r| tiene(r));
    let (mut modulos, mut acciones) = (vec!["inicio"], vec![]);
    let mut si = |cond: bool, m: &'static str| {
        if cond {
            modulos.push(m)
        }
    };
    match tipo {
        Tipo::Sucursal => {
            si(alguno(&["rol_vendedor", "rol_cajero", "rol_gerente_sucursal", "rol_auditor"]), "ventas");
            si(alguno(&["rol_cxc", "rol_gerente_sucursal", "rol_auditor"]), "cxc");
            si(alguno(&["rol_vendedor", "rol_gerente_sucursal", "rol_auditor"]), "inventario");
            si(alguno(&["rol_gerente_sucursal", "rol_auditor"]), "transferencias");
            si(true, "catalogo");
            si(alguno(&["rol_gerente_sucursal", "rol_auditor"]), "auditoria");
            for (a, rs) in [
                ("crear_venta", &["rol_vendedor"][..]),
                ("cobrar", &["rol_cajero"]),
                ("anular", &["rol_gerente_sucursal"]),
                ("pago", &["rol_cxc"]),
                ("recibir", &["rol_gerente_sucursal"]),
            ] {
                if alguno(rs) {
                    acciones.push(a);
                }
            }
        }
        Tipo::Almacen => {
            si(alguno(&["rol_almacen", "rol_auditor"]), "inventario");
            si(alguno(&["rol_almacen", "rol_auditor"]), "transferencias");
            si(true, "catalogo");
            si(alguno(&["rol_auditor"]), "auditoria");
            if alguno(&["rol_almacen"]) {
                acciones.push("despachar");
            }
        }
        Tipo::Corporativo => {
            si(alguno(&["rol_gerente_general", "rol_auditor", "rol_gerente_sucursal"]), "reportes");
            si(true, "catalogo");
            si(alguno(&["rol_auditor"]), "auditoria");
        }
    }
    (modulos, acciones)
}

/* ------------------------------------------------------------------ */
/* Sesión: login, perfil, logout                                       */
/* ------------------------------------------------------------------ */

#[derive(Deserialize)]
struct LoginReq {
    nodo: String,
    usuario: String,
    clave: String,
}

fn sid_nuevo() -> String {
    rand::random::<[u8; 32]>().iter().map(|b| format!("{b:02x}")).collect()
}

async fn login(State(app): State<App>, Json(req): Json<LoginReq>) -> Result<Response, ApiError> {
    let nodo = req.nodo.trim().to_uppercase();
    let usuario = req.usuario.trim().to_string();
    if usuario.is_empty() || req.clave.is_empty() || usuario.len() > 128 || req.clave.len() > 128 {
        return Err(ApiError::invalido("Escribe el usuario y la contraseña."));
    }
    let Some(dest) = app.destinos.get(&nodo).cloned() else {
        return Err(ApiError::invalido("La unidad elegida no existe."));
    };
    if app.sesiones.read().await.len() >= 200 {
        return Err(ApiError::nuevo(StatusCode::SERVICE_UNAVAILABLE, "Demasiadas sesiones abiertas."));
    }

    // El nombre de la red interna primero; si no resuelve (la app corre fuera del
    // contenedor), el puerto publicado por el servidor, en el servidor o en esta máquina.
    let publicado = puerto_publicado(&nodo);
    let candidatos = [
        (dest.host.clone(), dest.puerto),
        ("10.77.0.50".to_string(), publicado),
        ("127.0.0.1".to_string(), publicado),
    ];
    let mut cliente = None;
    let mut ultimo_error = None;
    for (host, puerto) in candidatos {
        match conectar(&host, puerto, &dest.base, &usuario, &req.clave).await {
            Ok(c) => {
                cliente = Some(c);
                break;
            }
            Err(e @ TdsError::Server(_)) => {
                ultimo_error = Some(e);
                break; // el motor respondió: el problema no es de red
            }
            Err(e) => ultimo_error = Some(e),
        }
    }
    let Some(mut cliente) = cliente else {
        tokio::time::sleep(Duration::from_millis(600)).await;
        return Err(match ultimo_error {
            Some(TdsError::Server(t)) => ApiError::nuevo(
                StatusCode::UNAUTHORIZED,
                format!("SQL Server rechazó el inicio de sesión en {} ({}): {}", nombre_nodo(&nodo), dest.base, t.message()),
            ),
            Some(e) => ApiError::nuevo(
                StatusCode::BAD_GATEWAY,
                format!("No se pudo conectar con {}: {e}", nombre_nodo(&nodo)),
            ),
            None => ApiError::nuevo(StatusCode::BAD_GATEWAY, "No se pudo conectar."),
        });
    };

    let columnas: String = ROLES
        .iter()
        .map(|(r, _)| match *r {
            "sysadmin" => "ISNULL(IS_SRVROLEMEMBER('sysadmin'),0) AS [sysadmin]".to_string(),
            r => format!("ISNULL(IS_ROLEMEMBER('{r}'),0) AS [{r}]"),
        })
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT SUSER_SNAME() AS usuario, @@SERVERNAME AS servidor, DB_NAME() AS base, \
         CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(40)) AS version, {columnas}"
    );
    let fila = cliente.query(sql, &[]).await?.into_row().await?.ok_or_else(|| ApiError::invalido("Sin perfil."))?;
    let nombres: Vec<String> = fila.columns().iter().map(|c| c.name().to_string()).collect();
    let mut campos = Map::new();
    for (n, d) in nombres.into_iter().zip(fila.into_iter()) {
        campos.insert(n, dato(d));
    }
    let roles: Vec<String> = ROLES
        .iter()
        .filter(|(r, _)| campos.get(*r).and_then(Value::as_i64) == Some(1))
        .map(|(r, _)| r.to_string())
        .collect();
    let rol_principal = ROLES
        .iter()
        .find(|(r, _)| roles.iter().any(|x| x == r))
        .map(|(_, n)| *n)
        .unwrap_or("Sin rol asignado");

    let tipo = Tipo::de(&nodo);
    let (modulos, acciones) = permisos(tipo, &roles);
    let perfil = json!({
        "usuario": campos["usuario"],
        "servidor": campos["servidor"],
        "version": campos["version"],
        "base": campos["base"],
        "nodo": nodo,
        "nodo_nombre": nombre_nodo(&nodo),
        "tipo": tipo.nombre(),
        "roles": roles,
        "rol_principal": rol_principal,
        "modulos": modulos,
        "acciones": acciones,
    });
    let sid = sid_nuevo();
    let sesion = Arc::new(Sesion {
        cliente: Mutex::new(cliente),
        tipo,
        nodo,
        perfil: perfil.clone(),
        ultimo: StdMutex::new(Instant::now()),
    });
    app.sesiones.write().await.insert(sid.clone(), sesion);

    let mut r = Json(perfil).into_response();
    r.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&format!("{COOKIE}={sid}; HttpOnly; SameSite=Strict; Path=/")).unwrap(),
    );
    Ok(r)
}

async fn perfil(Ses(s): Ses) -> Json<Value> {
    s.tocar();
    Json(s.perfil.clone())
}

async fn logout(State(app): State<App>, headers: axum::http::HeaderMap) -> Response {
    let sid = headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|c| c.split(';').map(str::trim).find_map(|kv| kv.strip_prefix("sigefer_sid=")))
        .unwrap_or("")
        .to_string();
    app.sesiones.write().await.remove(&sid);
    let mut r = Json(json!({ "ok": true })).into_response();
    r.headers_mut().insert(header::SET_COOKIE, cookie_borrar());
    r
}

/* ------------------------------------------------------------------ */
/* Entradas: validación de líneas                                      */
/* ------------------------------------------------------------------ */

#[derive(Deserialize)]
struct LineaReq {
    producto_id: i32,
    cantidad: f64,
    #[serde(default)]
    descuento: f64,
}

/// Arma los `VALUES` de una variable de tabla con números ya validados
/// (los tipos de tabla no viajan como parámetro por Tiberius).
fn valores(lineas: &[LineaReq], con_descuento: bool) -> Result<String, ApiError> {
    if lineas.is_empty() {
        return Err(ApiError::invalido("El documento no tiene líneas."));
    }
    if lineas.len() > 100 {
        return Err(ApiError::invalido("Máximo 100 líneas por documento."));
    }
    let mut por_producto: BTreeMap<i32, (f64, f64)> = BTreeMap::new();
    for l in lineas {
        if !l.cantidad.is_finite() || l.cantidad <= 0.0 || l.cantidad > 1e7 {
            return Err(ApiError::invalido("Las cantidades deben ser mayores que cero."));
        }
        if !l.descuento.is_finite() || l.descuento < 0.0 || l.descuento > 1e9 {
            return Err(ApiError::invalido("El descuento no es válido."));
        }
        let e = por_producto.entry(l.producto_id).or_insert((0.0, 0.0));
        e.0 += l.cantidad;
        e.1 += l.descuento;
    }
    Ok(por_producto
        .iter()
        .map(|(p, (c, d))| {
            if con_descuento {
                format!("({p},{c:.3},{d:.2})")
            } else {
                format!("({p},{c:.3})")
            }
        })
        .collect::<Vec<_>>()
        .join(","))
}

fn texto_opcional(t: Option<String>, max: usize) -> Option<String> {
    t.map(|s| s.trim().chars().take(max).collect::<String>()).filter(|s| !s.is_empty())
}

fn exigir(s: &Sesion, _accion: &str, tipo: Tipo) -> Result<(), ApiError> {
    if s.tipo != tipo {
        return Err(ApiError::invalido("Esa operación no existe en este nodo."));
    }
    // Sin pre-bloqueo por rol: la pantalla oculta el botón, pero si alguien fuerza la
    // llamada, el rechazo lo da SQL Server (EXECUTE denied), no la app.
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Catálogo: productos, clientes                                       */
/* ------------------------------------------------------------------ */

async fn productos(Ses(s): Ses) -> Res<Vec<Value>> {
    let precios = "LEFT JOIN cat.ListaPrecio lm ON lm.TipoCliente = 'MINORISTA' \
         LEFT JOIN cat.PrecioProducto pm ON pm.ListaPrecioId = lm.ListaPrecioId AND pm.ProductoId = p.ProductoId AND pm.Activo = 1 \
         LEFT JOIN cat.ListaPrecio ly ON ly.TipoCliente = 'MAYORISTA' \
         LEFT JOIN cat.PrecioProducto py ON py.ListaPrecioId = ly.ListaPrecioId AND py.ProductoId = p.ProductoId AND py.Activo = 1";
    let base = "SELECT p.ProductoId AS id, p.Codigo AS codigo, p.Nombre AS nombre, ca.Nombre AS categoria, \
         um.Codigo AS unidad, um.PermiteDecimales AS decimales";
    let uniones = "FROM cat.Producto p JOIN cat.Categoria ca ON ca.CategoriaId = p.CategoriaId \
         JOIN cat.UnidadMedida um ON um.UnidadMedidaId = p.UnidadMedidaId";
    let (existencia, tabla_exist) = match s.tipo {
        Tipo::Almacen => ("e.Existencia", "LEFT JOIN inv.ExistenciaAlmacen e ON e.ProductoId = p.ProductoId"),
        Tipo::Sucursal => ("i.Existencia", "LEFT JOIN inv.InventarioSucursal i ON i.ProductoId = p.ProductoId"),
        Tipo::Corporativo => ("CAST(NULL AS DECIMAL(12,3))", ""),
    };
    let alias_stock = if s.tipo == Tipo::Almacen { "e" } else { "i" };
    let minimo = format!("{alias_stock}.ExistenciaMinima");
    let intentos = [
        format!("{base}, pm.Precio AS minorista, py.Precio AS mayorista, {existencia} AS existencia, {minimo} AS minimo {uniones} {precios} {tabla_exist} WHERE p.Activo = 1"),
        format!("{base}, pm.Precio AS minorista, py.Precio AS mayorista, CAST(NULL AS DECIMAL(12,3)) AS existencia, CAST(NULL AS DECIMAL(12,3)) AS minimo {uniones} {precios} WHERE p.Activo = 1"),
        format!("{base}, CAST(NULL AS DECIMAL(12,2)) AS minorista, CAST(NULL AS DECIMAL(12,2)) AS mayorista, {existencia} AS existencia, {minimo} AS minimo {uniones} {tabla_exist} WHERE p.Activo = 1"),
        format!("{base}, CAST(NULL AS DECIMAL(12,2)) AS minorista, CAST(NULL AS DECIMAL(12,2)) AS mayorista, CAST(NULL AS DECIMAL(12,3)) AS existencia, CAST(NULL AS DECIMAL(12,3)) AS minimo {uniones} WHERE p.Activo = 1"),
    ];
    // Cada perfil ve lo que su rol permite: si falta un permiso, se cae al siguiente intento.
    let mut ultimo = None;
    for sql in intentos {
        match s.filas(&format!("{sql} ORDER BY p.Codigo"), &[]).await {
            Ok(f) => return Ok(Json(f)),
            Err(e) if e.cerrar_sesion => return Err(e),
            Err(e) => ultimo = Some(e),
        }
    }
    Err(ultimo.unwrap())
}

async fn clientes(Ses(s): Ses) -> Res<Vec<Value>> {
    Ok(Json(
        s.filas(
            "SELECT ClienteId AS id, Identificacion AS identificacion, Nombre AS nombre, TipoCliente AS tipo, \
             CodigoNodoAsignado AS sucursal, LimiteCredito AS limite, DiasCredito AS dias \
             FROM cat.Cliente WHERE Activo = 1 ORDER BY Nombre",
            &[],
        )
        .await?,
    ))
}

/* ------------------------------------------------------------------ */
/* Ventas                                                              */
/* ------------------------------------------------------------------ */

async fn ventas(Ses(s): Ses) -> Res<Vec<Value>> {
    Ok(Json(
        s.filas(
            "SELECT TOP 150 v.VentaId AS id, CONCAT(v.CodigoNodo, '-', v.VentaId) AS numero, \
             CONVERT(VARCHAR(16), v.Fecha, 120) AS fecha, c.Nombre AS cliente, v.CondicionPago AS tipo, \
             v.Subtotal AS subtotal, v.Impuesto AS impuesto, v.Total AS total, v.Estado AS estado, \
             v.UsuarioRegistro AS usuario \
             FROM ven.Venta v JOIN cat.Cliente c ON c.ClienteId = v.ClienteId \
             ORDER BY v.Fecha DESC, v.VentaId DESC",
            &[],
        )
        .await?,
    ))
}

async fn venta_detalle(Ses(s): Ses, Path(id): Path<i32>) -> Res<Vec<Value>> {
    Ok(Json(
        s.filas(
            "SELECT d.Linea AS linea, p.Codigo AS codigo, p.Nombre AS producto, d.Cantidad AS cantidad, \
             d.PrecioUnitario AS precio, d.Descuento AS descuento, d.Importe AS importe \
             FROM ven.DetalleVenta d JOIN cat.Producto p ON p.ProductoId = d.ProductoId \
             WHERE d.VentaId = @P1 ORDER BY d.Linea",
            &[&id],
        )
        .await?,
    ))
}

#[derive(Deserialize)]
struct VentaReq {
    cliente_id: i32,
    condicion: String,
    lineas: Vec<LineaReq>,
}

async fn venta_nueva(Ses(s): Ses, Json(r): Json<VentaReq>) -> Res<Value> {
    exigir(&s, "crear_venta", Tipo::Sucursal)?;
    let condicion = r.condicion.to_uppercase();
    if condicion != "CONTADO" && condicion != "CREDITO" {
        return Err(ApiError::invalido("La condición de pago debe ser CONTADO o CREDITO."));
    }
    let vals = valores(&r.lineas, true)?;
    let sql = format!(
        "SET NOCOUNT ON; DECLARE @l ven.LineaVenta; INSERT INTO @l (ProductoId, Cantidad, Descuento) VALUES {vals}; \
         DECLARE @id INT; \
         EXEC ven.usp_RegistrarVenta @ClienteId = @P1, @CondicionPago = @P2, @Lineas = @l, @PedidoId = NULL, @VentaId = @id OUTPUT; \
         SELECT @id AS id;"
    );
    let id = s.id_de(&sql, &[&r.cliente_id, &condicion]).await?;
    Ok(Json(json!({ "id": id, "mensaje": format!("Venta {}-{} registrada.", s.nodo, id) })))
}

async fn venta_cobrar(Ses(s): Ses, Path(id): Path<i32>) -> Res<Value> {
    exigir(&s, "cobrar", Tipo::Sucursal)?;
    s.ejecutar("EXEC ven.usp_CobrarVenta @VentaId = @P1", &[&id]).await?;
    Ok(Json(json!({ "mensaje": format!("Venta {}-{} cobrada.", s.nodo, id) })))
}

async fn venta_anular(Ses(s): Ses, Path(id): Path<i32>) -> Res<Value> {
    exigir(&s, "anular", Tipo::Sucursal)?;
    s.ejecutar("EXEC ven.usp_AnularVenta @VentaId = @P1", &[&id]).await?;
    Ok(Json(json!({ "mensaje": format!("Venta {}-{} anulada.", s.nodo, id) })))
}

/* ------------------------------------------------------------------ */
/* Cuentas por cobrar                                                  */
/* ------------------------------------------------------------------ */

async fn cxc(Ses(s): Ses) -> Res<Vec<Value>> {
    Ok(Json(
        s.filas(
            "SELECT cc.CuentaId AS id, CONCAT(cc.CodigoNodo, '-', cc.CuentaId) AS numero, \
             CONCAT(cc.CodigoNodo, '-', cc.VentaId) AS venta, cl.Nombre AS cliente, \
             CONVERT(VARCHAR(10), cc.FechaEmision, 23) AS emision, CONVERT(VARCHAR(10), cc.FechaVencimiento, 23) AS vence, \
             cc.Monto AS monto, cc.Saldo AS saldo, cl.LimiteCredito AS limite, \
             ISNULL((SELECT SUM(x.Saldo) FROM cxc.CuentaPorCobrar x WHERE x.ClienteId = cc.ClienteId AND x.Estado IN ('PENDIENTE','VENCIDA')), 0) AS deuda_cliente, \
             CASE WHEN cc.Saldo > 0 THEN DATEDIFF(DAY, cc.FechaVencimiento, CAST(SYSDATETIME() AS DATE)) END AS dias_atraso, \
             cc.Estado AS estado \
             FROM cxc.CuentaPorCobrar cc JOIN cat.Cliente cl ON cl.ClienteId = cc.ClienteId \
             ORDER BY CASE WHEN cc.Saldo > 0 THEN 0 ELSE 1 END, cc.FechaVencimiento, cc.CuentaId",
            &[],
        )
        .await?,
    ))
}

async fn cxc_pagos(Ses(s): Ses) -> Res<Vec<Value>> {
    Ok(Json(
        s.filas(
            "SELECT TOP 100 p.PagoId AS id, CONCAT(p.CodigoNodo, '-', p.CuentaId) AS cuenta, CONVERT(VARCHAR(16), p.Fecha, 120) AS fecha, \
             p.Monto AS monto, p.FormaPago AS forma, p.Referencia AS referencia, p.UsuarioRegistro AS usuario \
             FROM cxc.Pago p ORDER BY p.Fecha DESC, p.PagoId DESC",
            &[],
        )
        .await?,
    ))
}

#[derive(Deserialize)]
struct PagoReq {
    cuenta_id: i32,
    monto: f64,
    forma: String,
    referencia: Option<String>,
}

async fn cxc_pago(Ses(s): Ses, Json(r): Json<PagoReq>) -> Res<Value> {
    exigir(&s, "pago", Tipo::Sucursal)?;
    if !r.monto.is_finite() || r.monto <= 0.0 || r.monto > 1e9 {
        return Err(ApiError::invalido("El monto del pago debe ser mayor que cero."));
    }
    let forma = r.forma.to_uppercase();
    if !["EFECTIVO", "TRANSFERENCIA", "CHEQUE", "TARJETA"].contains(&forma.as_str()) {
        return Err(ApiError::invalido("Forma de pago no válida."));
    }
    let monto = format!("{:.2}", r.monto);
    let referencia = texto_opcional(r.referencia, 40);
    let id = s
        .id_de(
            "SET NOCOUNT ON; DECLARE @m DECIMAL(12,2) = CONVERT(DECIMAL(12,2), @P2); DECLARE @id INT; \
             EXEC cxc.usp_RegistrarPago @CuentaId = @P1, @Monto = @m, @FormaPago = @P3, @Referencia = @P4, @PagoId = @id OUTPUT; \
             SELECT @id AS id;",
            &[&r.cuenta_id, &monto, &forma, &referencia],
        )
        .await?;
    Ok(Json(json!({ "id": id, "mensaje": format!("Pago {}-{} registrado por C$ {monto}.", s.nodo, id) })))
}

/* ------------------------------------------------------------------ */
/* Inventario y transferencias                                         */
/* ------------------------------------------------------------------ */

async fn inventario(Ses(s): Ses) -> Res<Vec<Value>> {
    let sql = match s.tipo {
        Tipo::Almacen => {
            "SELECT p.ProductoId AS id, p.Codigo AS codigo, p.Nombre AS producto, ca.Nombre AS categoria, um.Codigo AS unidad, \
             e.Existencia AS existencia, e.ExistenciaMinima AS minimo, e.Ubicacion AS ubicacion, \
             CONVERT(VARCHAR(16), e.FechaActualizacion, 120) AS actualizado \
             FROM inv.ExistenciaAlmacen e JOIN cat.Producto p ON p.ProductoId = e.ProductoId \
             JOIN cat.Categoria ca ON ca.CategoriaId = p.CategoriaId JOIN cat.UnidadMedida um ON um.UnidadMedidaId = p.UnidadMedidaId \
             ORDER BY p.Codigo"
        }
        Tipo::Sucursal => {
            "SELECT p.ProductoId AS id, p.Codigo AS codigo, p.Nombre AS producto, ca.Nombre AS categoria, um.Codigo AS unidad, \
             i.Existencia AS existencia, i.ExistenciaMinima AS minimo, CAST(NULL AS VARCHAR(20)) AS ubicacion, \
             CONVERT(VARCHAR(16), i.FechaActualizacion, 120) AS actualizado \
             FROM inv.InventarioSucursal i JOIN cat.Producto p ON p.ProductoId = i.ProductoId \
             JOIN cat.Categoria ca ON ca.CategoriaId = p.CategoriaId JOIN cat.UnidadMedida um ON um.UnidadMedidaId = p.UnidadMedidaId \
             ORDER BY p.Codigo"
        }
        Tipo::Corporativo => return Err(ApiError::invalido("El inventario consolidado está en Reportes.")),
    };
    Ok(Json(s.filas(sql, &[]).await?))
}

async fn transferencias(Ses(s): Ses) -> Res<Vec<Value>> {
    let sql = match s.tipo {
        Tipo::Almacen => {
            "SELECT t.TransferenciaId AS id, CONCAT(t.CodigoNodo, '-', t.TransferenciaId) AS numero, t.CodigoNodoDestino AS destino, \
             CONVERT(VARCHAR(16), t.FechaDespacho, 120) AS despacho, CONVERT(VARCHAR(16), t.FechaRecepcion, 120) AS recepcion, \
             (SELECT COUNT(*) FROM inv.DetalleTransferencia d WHERE d.CodigoNodo = t.CodigoNodo AND d.TransferenciaId = t.TransferenciaId) AS lineas, \
             (SELECT SUM(d.CantidadEnviada) FROM inv.DetalleTransferencia d WHERE d.CodigoNodo = t.CodigoNodo AND d.TransferenciaId = t.TransferenciaId) AS unidades, \
             t.Estado AS estado, t.Observacion AS observacion \
             FROM inv.Transferencia t ORDER BY t.TransferenciaId DESC"
        }
        Tipo::Sucursal => {
            "SELECT r.RecepcionId AS id, CONCAT(r.TransferenciaNodo, '-', r.TransferenciaId) AS numero, r.CodigoNodo AS destino, \
             CONVERT(VARCHAR(16), r.FechaDespacho, 120) AS despacho, CONVERT(VARCHAR(16), r.FechaRecepcion, 120) AS recepcion, \
             (SELECT COUNT(*) FROM inv.DetalleRecepcionTransferencia d WHERE d.CodigoNodo = r.CodigoNodo AND d.RecepcionId = r.RecepcionId) AS lineas, \
             (SELECT SUM(d.CantidadEnviada) FROM inv.DetalleRecepcionTransferencia d WHERE d.CodigoNodo = r.CodigoNodo AND d.RecepcionId = r.RecepcionId) AS unidades, \
             r.Estado AS estado, r.Observacion AS observacion \
             FROM inv.RecepcionTransferencia r \
             ORDER BY CASE r.Estado WHEN 'EN_TRANSITO' THEN 0 ELSE 1 END, r.RecepcionId DESC"
        }
        Tipo::Corporativo => return Err(ApiError::invalido("Las transferencias consolidadas están en Reportes.")),
    };
    Ok(Json(s.filas(sql, &[]).await?))
}

async fn transferencia_detalle(Ses(s): Ses, Path(id): Path<i32>) -> Res<Vec<Value>> {
    let sql = match s.tipo {
        Tipo::Almacen => {
            "SELECT d.Linea AS linea, p.Codigo AS codigo, p.Nombre AS producto, um.Codigo AS unidad, \
             d.CantidadEnviada AS enviada, d.CantidadRecibida AS recibida \
             FROM inv.DetalleTransferencia d JOIN cat.Producto p ON p.ProductoId = d.ProductoId \
             JOIN cat.UnidadMedida um ON um.UnidadMedidaId = p.UnidadMedidaId \
             WHERE d.TransferenciaId = @P1 ORDER BY d.Linea"
        }
        Tipo::Sucursal => {
            "SELECT d.Linea AS linea, p.Codigo AS codigo, p.Nombre AS producto, um.Codigo AS unidad, \
             d.CantidadEnviada AS enviada, d.CantidadRecibida AS recibida \
             FROM inv.DetalleRecepcionTransferencia d JOIN cat.Producto p ON p.ProductoId = d.ProductoId \
             JOIN cat.UnidadMedida um ON um.UnidadMedidaId = p.UnidadMedidaId \
             WHERE d.RecepcionId = @P1 ORDER BY d.Linea"
        }
        Tipo::Corporativo => return Err(ApiError::invalido("No aplica en el corporativo.")),
    };
    Ok(Json(s.filas(sql, &[&id]).await?))
}

#[derive(Deserialize)]
struct DespachoReq {
    destino: String,
    observacion: Option<String>,
    lineas: Vec<LineaReq>,
}

async fn transferencia_despachar(Ses(s): Ses, Json(r): Json<DespachoReq>) -> Res<Value> {
    exigir(&s, "despachar", Tipo::Almacen)?;
    let destino = r.destino.to_uppercase();
    if !["CEN", "NOR", "SUR", "EST"].contains(&destino.as_str()) {
        return Err(ApiError::invalido("El destino debe ser una sucursal: CEN, NOR, SUR o EST."));
    }
    let vals = valores(&r.lineas, false)?;
    let observacion = texto_opcional(r.observacion, 400);
    let sql = format!(
        "SET NOCOUNT ON; DECLARE @l inv.LineaTransferencia; INSERT INTO @l (ProductoId, Cantidad) VALUES {vals}; \
         DECLARE @id INT; \
         EXEC inv.usp_DespacharTransferencia @CodigoNodoDestino = @P1, @Lineas = @l, @Observacion = @P2, @TransferenciaId = @id OUTPUT; \
         SELECT @id AS id;"
    );
    let id = s.id_de(&sql, &[&destino, &observacion]).await?;
    Ok(Json(json!({ "id": id, "mensaje": format!("Transferencia ALM-{id} despachada a {destino}.") })))
}

#[derive(Deserialize)]
struct RecLinea {
    linea: i16,
    cantidad: f64,
}
#[derive(Deserialize, Default)]
struct RecepcionReq {
    #[serde(default)]
    lineas: Vec<RecLinea>,
}

async fn transferencia_recibir(Ses(s): Ses, Path(id): Path<i32>, Json(r): Json<RecepcionReq>) -> Res<Value> {
    exigir(&s, "recibir", Tipo::Sucursal)?;
    let mut vals = Vec::new();
    for l in &r.lineas {
        if !l.cantidad.is_finite() || l.cantidad < 0.0 || l.cantidad > 1e7 {
            return Err(ApiError::invalido("Las cantidades recibidas no son válidas."));
        }
        vals.push(format!("({},{:.3})", l.linea, l.cantidad));
    }
    // El procedimiento no lo valida: no puede llegar más de lo que se envió.
    let enviadas = s
        .filas(
            "SELECT Linea AS linea, CantidadEnviada AS enviada FROM inv.DetalleRecepcionTransferencia WHERE RecepcionId = @P1",
            &[&id],
        )
        .await?;
    for l in &r.lineas {
        let enviada = enviadas.iter().find(|e| e["linea"].as_i64() == Some(l.linea as i64)).and_then(|e| e["enviada"].as_f64());
        if enviada.is_some_and(|e| l.cantidad > e + 0.0005) {
            return Err(ApiError::invalido(format!("La línea {} no puede recibir más de lo enviado ({}).", l.linea, enviada.unwrap())));
        }
    }
    let insertar = if vals.is_empty() {
        String::new()
    } else {
        format!("INSERT INTO @l (Linea, CantidadRecibida) VALUES {};", vals.join(","))
    };
    let sql = format!("SET NOCOUNT ON; DECLARE @l inv.LineaRecepcion; {insertar} EXEC inv.usp_ConfirmarRecepcion @RecepcionId = @P1, @Lineas = @l;");
    s.ejecutar(&sql, &[&id]).await?;
    Ok(Json(json!({ "mensaje": format!("Recepción {}-{} confirmada: el inventario se actualizó.", s.nodo, id) })))
}

/* ------------------------------------------------------------------ */
/* Reportes consolidados y auditoría                                   */
/* ------------------------------------------------------------------ */

async fn reporte(Ses(s): Ses, Path(nombre): Path<String>) -> Res<Vec<Value>> {
    if s.tipo != Tipo::Corporativo {
        return Err(ApiError::invalido("Los reportes consolidados se consultan en el nodo corporativo."));
    }
    let sql = match nombre.as_str() {
        "ventas" => {
            "SELECT CodigoNodo AS nodo, Sucursal AS sucursal, CONVERT(VARCHAR(10), Fecha, 23) AS fecha, Ventas AS ventas, \
             Contado AS contado, Credito AS credito, Subtotal AS subtotal, Impuesto AS impuesto, Total AS total \
             FROM rep.VentasPorSucursal ORDER BY Fecha DESC, CodigoNodo"
        }
        "existencias" => {
            "SELECT Codigo AS codigo, Producto AS producto, Unidad AS unidad, Central AS central, Norte AS norte, Sur AS sur, \
             Este AS este, Almacen AS almacen, EnTransito AS transito, Total AS total FROM rep.ExistenciasTotales ORDER BY Codigo"
        }
        "saldos" => {
            "SELECT CodigoNodo AS nodo, Sucursal AS sucursal, CuentaId AS cuenta, Cliente AS cliente, VentaId AS venta, \
             CONVERT(VARCHAR(10), FechaEmision, 23) AS emision, CONVERT(VARCHAR(10), FechaVencimiento, 23) AS vence, \
             Monto AS monto, Saldo AS saldo, DiasAtraso AS dias_atraso, Estado AS estado \
             FROM rep.SaldosPorCobrar ORDER BY Saldo DESC"
        }
        "transito" => {
            "SELECT TransferenciaId AS id, Destino AS destino, CONVERT(VARCHAR(16), FechaDespacho, 120) AS despacho, Estado AS estado, \
             EstadoRecepcion AS recepcion, Lineas AS lineas, CantidadEnviada AS unidades, HorasDesdeDespacho AS horas \
             FROM rep.TransferenciasEnTransito ORDER BY FechaDespacho DESC"
        }
        _ => return Err(ApiError::invalido("Ese reporte no existe.")),
    };
    Ok(Json(s.filas(sql, &[]).await?))
}

async fn auditoria(Ses(s): Ses) -> Res<Vec<Value>> {
    Ok(Json(
        s.filas(
            "SELECT TOP 200 BitacoraId AS id, CodigoNodo AS nodo, CONVERT(VARCHAR(19), Fecha, 120) AS fecha, [Login] AS usuario, \
             Objeto AS objeto, Operacion AS operacion, Llave AS llave, ValorAnterior AS anterior, ValorNuevo AS nuevo \
             FROM aud.BitacoraAuditoria ORDER BY Fecha DESC, BitacoraId DESC",
            &[],
        )
        .await?,
    ))
}

/* ------------------------------------------------------------------ */
/* Inicio: indicadores y serie                                         */
/* ------------------------------------------------------------------ */

async fn inicio(Ses(s): Ses) -> Res<Value> {
    // (id, título, formato, consulta con columnas valor y detalle)
    let kpis: Vec<(&str, &str, &str, &str)> = match s.tipo {
        Tipo::Sucursal => vec![
            ("ventas", "Ventas del día", "money", "SELECT ISNULL(SUM(Total),0) AS valor, CONCAT(COUNT(*), ' facturas') AS detalle FROM ven.Venta WHERE Estado <> 'ANULADA' AND CAST(Fecha AS DATE) = CAST(SYSDATETIME() AS DATE)"),
            ("acumulado", "Ventas acumuladas", "money", "SELECT ISNULL(SUM(Total),0) AS valor, CONCAT(COUNT(*), ' facturas no anuladas') AS detalle FROM ven.Venta WHERE Estado <> 'ANULADA'"),
            ("cobrar", "Por cobrar", "money", "SELECT ISNULL(SUM(Saldo),0) AS valor, CONCAT(COUNT(*), ' cuentas con saldo') AS detalle FROM cxc.CuentaPorCobrar WHERE Saldo > 0"),
            ("bajo", "Productos bajo mínimo", "int", "SELECT COUNT(*) AS valor, CONCAT('de ', (SELECT COUNT(*) FROM inv.InventarioSucursal), ' en existencia') AS detalle FROM inv.InventarioSucursal WHERE Existencia <= ExistenciaMinima"),
            ("transito", "Transferencias en tránsito", "int", "SELECT COUNT(*) AS valor, 'pendientes de recibir' AS detalle FROM inv.RecepcionTransferencia WHERE Estado = 'EN_TRANSITO'"),
        ],
        Tipo::Almacen => vec![
            ("productos", "Productos en bodega", "int", "SELECT COUNT(*) AS valor, 'con registro de existencia' AS detalle FROM inv.ExistenciaAlmacen"),
            ("unidades", "Unidades almacenadas", "num", "SELECT ISNULL(SUM(Existencia),0) AS valor, 'suma de existencias' AS detalle FROM inv.ExistenciaAlmacen"),
            ("bajo", "Productos bajo mínimo", "int", "SELECT COUNT(*) AS valor, 'por reponer al proveedor' AS detalle FROM inv.ExistenciaAlmacen WHERE Existencia <= ExistenciaMinima"),
            ("despachos", "Transferencias despachadas", "int", "SELECT COUNT(*) AS valor, CONCAT(SUM(CASE WHEN Estado <> 'RECIBIDA' THEN 1 ELSE 0 END), ' sin confirmar') AS detalle FROM inv.Transferencia"),
        ],
        Tipo::Corporativo => vec![
            ("ventas", "Ventas consolidadas", "money", "SELECT ISNULL(SUM(Total),0) AS valor, CONCAT(ISNULL(SUM(Ventas),0), ' ventas en 5 nodos') AS detalle FROM rep.VentasPorSucursal"),
            ("saldos", "Saldo por cobrar", "money", "SELECT ISNULL(SUM(Saldo),0) AS valor, CONCAT(COUNT(*), ' cuentas') AS detalle FROM rep.SaldosPorCobrar"),
            ("transito", "Transferencias en tránsito", "int", "SELECT COUNT(*) AS valor, 'según el corporativo' AS detalle FROM rep.TransferenciasEnTransito"),
            ("auditoria", "Eventos de auditoría", "int", "SELECT COUNT(*) AS valor, 'consolidados de los nodos' AS detalle FROM aud.BitacoraAuditoria"),
        ],
    };
    let mut tarjetas = Vec::new();
    for (id, titulo, formato, sql) in kpis {
        let r = s.filas(sql, &[]).await;
        let (valor, detalle, error) = match r {
            Ok(f) => {
                let f = f.into_iter().next().unwrap_or(Value::Null);
                (f["valor"].clone(), f["detalle"].clone(), Value::Null)
            }
            Err(e) if e.cerrar_sesion => return Err(e),
            Err(e) => (Value::Null, Value::Null, Value::String(e.mensaje)),
        };
        tarjetas.push(json!({ "id": id, "titulo": titulo, "formato": formato, "valor": valor, "detalle": detalle, "error": error }));
    }
    let (titulo_serie, formato_serie, sql_serie) = match s.tipo {
        Tipo::Sucursal => ("Ventas por día", "money", "SELECT TOP 7 etiqueta, valor FROM (SELECT CONVERT(VARCHAR(10), Fecha, 23) AS etiqueta, SUM(Total) AS valor FROM ven.Venta WHERE Estado <> 'ANULADA' GROUP BY CONVERT(VARCHAR(10), Fecha, 23)) t ORDER BY etiqueta DESC"),
        Tipo::Almacen => ("Mayores existencias en bodega", "num", "SELECT TOP 8 LEFT(p.Nombre, 28) AS etiqueta, e.Existencia AS valor FROM inv.ExistenciaAlmacen e JOIN cat.Producto p ON p.ProductoId = e.ProductoId ORDER BY e.Existencia DESC"),
        Tipo::Corporativo => ("Ventas por sucursal", "money", "SELECT Sucursal AS etiqueta, SUM(Total) AS valor FROM rep.VentasPorSucursal GROUP BY Sucursal ORDER BY SUM(Total) DESC"),
    };
    let serie = s.filas(sql_serie, &[]).await.unwrap_or_default();
    Ok(Json(json!({ "tarjetas": tarjetas, "serie": { "titulo": titulo_serie, "formato": formato_serie, "puntos": serie } })))
}

/* ------------------------------------------------------------------ */
/* Estáticos y arranque                                                */
/* ------------------------------------------------------------------ */

fn estatico(tipo: &'static str, cuerpo: &'static str) -> impl IntoResponse {
    ([(header::CONTENT_TYPE, tipo), (header::CACHE_CONTROL, "no-cache")], cuerpo)
}

async fn cabeceras(req: Request, next: Next) -> Response {
    let mut r = next.run(req).await;
    let h = r.headers_mut();
    h.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    h.insert("x-frame-options", HeaderValue::from_static("DENY"));
    h.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    h.insert(
        "content-security-policy",
        HeaderValue::from_static("default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"),
    );
    r
}

#[tokio::main]
async fn main() {
    let nodos = std::env::var("SIGEFER_NODOS").unwrap_or_else(|_| NODOS_POR_DEFECTO.to_string());
    let destinos = leer_nodos(&nodos);
    let escucha = std::env::var("SIGEFER_BIND").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let app: App = Arc::new(Estado { destinos, sesiones: RwLock::new(HashMap::new()) });

    // Cierra las sesiones con más de 30 minutos sin uso.
    let limpieza = app.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            limpieza.sesiones.write().await.retain(|_, s| s.ultimo.lock().unwrap().elapsed() < INACTIVIDAD);
        }
    });

    let rutas = Router::new()
        .route("/", get(|| async { estatico("text/html; charset=utf-8", include_str!("../static/index.html")) }))
        .route("/app.css", get(|| async { estatico("text/css; charset=utf-8", include_str!("../static/app.css")) }))
        .route("/app.js", get(|| async { estatico("text/javascript; charset=utf-8", include_str!("../static/app.js")) }))
        .route("/favicon.svg", get(|| async { estatico("image/svg+xml", include_str!("../static/favicon.svg")) }))
        .route("/api/salud", get(|| async { Json(json!({ "estado": "ok", "app": "SIGEFER", "version": env!("CARGO_PKG_VERSION") })) }))
        .route("/api/login", post(login))
        .route("/api/logout", post(logout))
        .route("/api/perfil", get(perfil))
        .route("/api/inicio", get(inicio))
        .route("/api/productos", get(productos))
        .route("/api/clientes", get(clientes))
        .route("/api/ventas", get(ventas).post(venta_nueva))
        .route("/api/ventas/{id}/detalle", get(venta_detalle))
        .route("/api/ventas/{id}/cobrar", post(venta_cobrar))
        .route("/api/ventas/{id}/anular", post(venta_anular))
        .route("/api/cxc", get(cxc))
        .route("/api/cxc/pagos", get(cxc_pagos).post(cxc_pago))
        .route("/api/inventario", get(inventario))
        .route("/api/transferencias", get(transferencias).post(transferencia_despachar))
        .route("/api/transferencias/{id}/detalle", get(transferencia_detalle))
        .route("/api/transferencias/{id}/recibir", post(transferencia_recibir))
        .route("/api/reportes/{nombre}", get(reporte))
        .route("/api/auditoria", get(auditoria))
        .layer(middleware::from_fn(cabeceras))
        .with_state(app);

    let listener = tokio::net::TcpListener::bind(&escucha).await.expect("no se pudo abrir el puerto");
    println!("SIGEFER escuchando en http://{escucha}");
    axum::serve(listener, rutas).await.expect("servidor detenido");
}
