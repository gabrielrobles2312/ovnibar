const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.NETLIFY_DATABASE_URL);

const H = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
};

const ok  = d => ({ statusCode: 200, headers: H, body: JSON.stringify(d) });
const err = (m, c) => ({ statusCode: c||500, headers: H, body: JSON.stringify({ error: m }) });

async function initDB() {
  await sql`CREATE TABLE IF NOT EXISTS mesas (
    id SERIAL PRIMARY KEY, num INT UNIQUE NOT NULL,
    estado TEXT DEFAULT 'libre', comanda JSONB DEFAULT '[]',
    abierta_en TEXT, mesero TEXT, mesero_email TEXT
  )`;
  await sql`CREATE TABLE IF NOT EXISTS ventas (
    id SERIAL PRIMARY KEY, fecha TEXT NOT NULL, hora TEXT,
    mesa INT, producto TEXT, cantidad INT, precio INT, total INT,
    pago TEXT, cajero TEXT, cajero_email TEXT, comp TEXT,
    turno_id INT, descuento INT DEFAULT 0, propina INT DEFAULT 0,
    es_cortesia BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS carta (
    id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, categoria TEXT,
    precio INT, emoji TEXT, activo BOOLEAN DEFAULT true,
    agotado BOOLEAN DEFAULT false
  )`;
  await sql`CREATE TABLE IF NOT EXISTS combos (
    id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, descripcion TEXT,
    precio INT, emoji TEXT, items JSONB DEFAULT '[]',
    activo BOOLEAN DEFAULT true
  )`;
  await sql`CREATE TABLE IF NOT EXISTS inventario (
    id SERIAL PRIMARY KEY, producto TEXT UNIQUE NOT NULL,
    stock INT DEFAULT 0, minimo INT DEFAULT 0, movs JSONB DEFAULT '[]'
  )`;
  await sql`CREATE TABLE IF NOT EXISTS usuarios (
    email TEXT PRIMARY KEY, nombre TEXT, rol TEXT, foto TEXT
  )`;
  await sql`CREATE TABLE IF NOT EXISTS turnos (
    id SERIAL PRIMARY KEY, fecha TEXT NOT NULL,
    nombre TEXT, cajero TEXT, cajero_email TEXT,
    caja_inicial INT DEFAULT 0, caja_final INT DEFAULT 0,
    abierto_en TEXT, cerrado_en TEXT,
    estado TEXT DEFAULT 'abierto',
    notas TEXT
  )`;
  await sql`CREATE TABLE IF NOT EXISTS gastos (
    id SERIAL PRIMARY KEY, fecha TEXT NOT NULL, hora TEXT,
    categoria TEXT, descripcion TEXT, monto INT,
    cajero TEXT, turno_id INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS fiados (
    id SERIAL PRIMARY KEY, fecha TEXT NOT NULL, hora TEXT,
    cliente TEXT NOT NULL, monto INT, descripcion TEXT,
    estado TEXT DEFAULT 'pendiente', fecha_pago TEXT,
    cajero TEXT, mesa INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS reservas (
    id SERIAL PRIMARY KEY, fecha TEXT NOT NULL, hora TEXT,
    nombre TEXT NOT NULL, telefono TEXT, personas INT,
    mesa INT, estado TEXT DEFAULT 'pendiente', notas TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS eventos (
    id SERIAL PRIMARY KEY, fecha TEXT NOT NULL,
    nombre TEXT NOT NULL, descripcion TEXT,
    cover INT DEFAULT 0, activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS log_actividad (
    id SERIAL PRIMARY KEY, fecha TEXT NOT NULL, hora TEXT,
    usuario TEXT, usuario_email TEXT, accion TEXT, detalle TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY, value JSONB
  )`;

  const [{ c: mc }] = await sql`SELECT COUNT(*) as c FROM mesas`;
  if (parseInt(mc) === 0) {
    for (let i = 1; i <= 10; i++) {
      await sql`INSERT INTO mesas (num) VALUES (${i}) ON CONFLICT DO NOTHING`;
    }
  }
  const [{ c: cc }] = await sql`SELECT COUNT(*) as c FROM carta`;
  if (parseInt(cc) === 0) {
    const items = [
      ["Corona","🍺 Cervezas",9000,"🍺"],["Aguila","🍺 Cervezas",8000,"🍺"],
      ["Poker","🍺 Cervezas",7000,"🍺"],["Club Colombia","🍺 Cervezas",9000,"🍺"],
      ["Andina","🍺 Cervezas",45000,"🍺"],["Botella Azul","🥃 Licores",83000,"🥃"],
      ["Botella Amarillo","🥃 Licores",75000,"🥃"],["Media Amarillo","🥃 Licores",40000,"🥃"],
      ["Smirnoff Botella","🥃 Licores",75000,"🥃"],["Ron Botella","🥃 Licores",70000,"🥃"],
      ["Ron Litro","🥃 Licores",30000,"🥃"],["Ron Limar","🥃 Licores",7000,"🥃"],
      ["Red Bull","🥤 Sin alcohol",12000,"🥤"],["Gatorade","🥤 Sin alcohol",6000,"🥤"],
      ["Agua","🥤 Sin alcohol",3000,"🥤"],["Coca Cola","🥤 Sin alcohol",5000,"🥤"]
    ];
    for (const [nombre, categoria, precio, emoji] of items) {
      await sql`INSERT INTO carta (nombre,categoria,precio,emoji) VALUES (${nombre},${categoria},${precio},${emoji})`;
    }
  }
  const [{ c: ic }] = await sql`SELECT COUNT(*) as c FROM inventario`;
  if (parseInt(ic) === 0) {
    const inv = [
      ["Corona",24,6],["Aguila",12,6],["Poker",18,6],["Andina",10,4],
      ["Red Bull",8,4],["Gatorade",12,4],["Agua",20,6],["Coca Cola",10,4],
      ["Smirnoff Botella",3,2],["Ron Botella",4,2],["Ron Litro",2,1],
      ["Botella Azul",3,1],["Botella Amarillo",2,1]
    ];
    for (const [producto, stock, minimo] of inv) {
      await sql`INSERT INTO inventario (producto,stock,minimo) VALUES (${producto},${stock},${minimo})`;
    }
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  try {
    await initDB();
    const path = (event.path || "").replace("/.netlify/functions/api", "");
    const method = event.httpMethod;
    const body = event.body ? JSON.parse(event.body) : {};
    const qs = event.queryStringParameters || {};

    // ── MESAS ──
    if (path === "/mesas" && method === "GET") {
      return ok(await sql`SELECT * FROM mesas ORDER BY num`);
    }
    if (path === "/mesas" && method === "POST") {
      await sql`INSERT INTO mesas (num) VALUES (${body.num}) ON CONFLICT DO NOTHING`;
      return ok({ done: true });
    }
    if (/^\/mesas\/\d+$/.test(path) && method === "PUT") {
      const num = parseInt(path.split("/")[2]);
      const { estado, comanda, abierta_en, mesero, mesero_email } = body;
      await sql`UPDATE mesas SET estado=${estado||"libre"}, comanda=${JSON.stringify(comanda||[])}, abierta_en=${abierta_en||null}, mesero=${mesero||null}, mesero_email=${mesero_email||null} WHERE num=${num}`;
      return ok({ done: true });
    }

    // ── VENTAS ──
    if (path === "/ventas" && method === "GET") {
      if (qs.fecha) {
        return ok(await sql`SELECT * FROM ventas WHERE fecha=${qs.fecha} ORDER BY created_at ASC`);
      }
      if (qs.desde && qs.hasta) {
        return ok(await sql`SELECT * FROM ventas WHERE fecha >= ${qs.desde} AND fecha <= ${qs.hasta} ORDER BY fecha ASC, created_at ASC`);
      }
      return ok(await sql`SELECT * FROM ventas ORDER BY created_at DESC LIMIT 500`);
    }
    if (path === "/ventas" && method === "POST") {
      const { fecha, hora, mesa, producto, cantidad, precio, total, pago, cajero, cajero_email, comp, turno_id, descuento, propina, es_cortesia } = body;
      const r = await sql`INSERT INTO ventas (fecha,hora,mesa,producto,cantidad,precio,total,pago,cajero,cajero_email,comp,turno_id,descuento,propina,es_cortesia) VALUES (${fecha},${hora||null},${mesa||null},${producto},${cantidad||1},${precio||0},${total||0},${pago},${cajero||null},${cajero_email||null},${comp||null},${turno_id||null},${descuento||0},${propina||0},${es_cortesia||false}) RETURNING id`;
      await logActividad(sql, fecha, hora||"", cajero||"", cajero_email||"", "venta_registrada", "Mesa " + (mesa||"-") + ": " + producto + " x" + (cantidad||1));
      return ok(r[0]);
    }
    if (/^\/ventas\/\d+$/.test(path) && method === "DELETE") {
      const id = parseInt(path.split("/")[2]);
      await sql`DELETE FROM ventas WHERE id=${id}`;
      return ok({ done: true });
    }

    // ── CARTA ──
    if (path === "/carta" && method === "GET") {
      return ok(await sql`SELECT * FROM carta WHERE activo=true ORDER BY categoria, nombre`);
    }
    if (path === "/carta" && method === "POST") {
      const { nombre, categoria, precio, emoji } = body;
      const r = await sql`INSERT INTO carta (nombre,categoria,precio,emoji) VALUES (${nombre},${categoria||"⭐ Especiales"},${precio||0},${emoji||"🍹"}) RETURNING *`;
      return ok(r[0]);
    }
    if (/^\/carta\/\d+$/.test(path) && method === "PUT") {
      const id = parseInt(path.split("/")[2]);
      const { nombre, categoria, precio, emoji, agotado } = body;
      await sql`UPDATE carta SET nombre=${nombre},categoria=${categoria},precio=${precio||0},emoji=${emoji||"🍹"},agotado=${agotado||false} WHERE id=${id}`;
      return ok({ done: true });
    }
    if (/^\/carta\/\d+$/.test(path) && method === "DELETE") {
      const id = parseInt(path.split("/")[2]);
      await sql`UPDATE carta SET activo=false WHERE id=${id}`;
      return ok({ done: true });
    }

    // ── COMBOS ──
    if (path === "/combos" && method === "GET") {
      return ok(await sql`SELECT * FROM combos WHERE activo=true ORDER BY nombre`);
    }
    if (path === "/combos" && method === "POST") {
      const { nombre, descripcion, precio, emoji, items } = body;
      const r = await sql`INSERT INTO combos (nombre,descripcion,precio,emoji,items) VALUES (${nombre},${descripcion||""},${precio||0},${emoji||"⭐"},${JSON.stringify(items||[])}) RETURNING *`;
      return ok(r[0]);
    }
    if (/^\/combos\/\d+$/.test(path) && method === "PUT") {
      const id = parseInt(path.split("/")[2]);
      const { nombre, descripcion, precio, emoji, items } = body;
      await sql`UPDATE combos SET nombre=${nombre},descripcion=${descripcion||""},precio=${precio||0},emoji=${emoji||"⭐"},items=${JSON.stringify(items||[])} WHERE id=${id}`;
      return ok({ done: true });
    }
    if (/^\/combos\/\d+$/.test(path) && method === "DELETE") {
      const id = parseInt(path.split("/")[2]);
      await sql`UPDATE combos SET activo=false WHERE id=${id}`;
      return ok({ done: true });
    }

    // ── INVENTARIO ──
    if (path === "/inventario" && method === "GET") {
      return ok(await sql`SELECT * FROM inventario ORDER BY producto`);
    }
    if (path === "/inventario" && method === "POST") {
      const { producto, stock, minimo } = body;
      await sql`INSERT INTO inventario (producto,stock,minimo) VALUES (${producto},${stock||0},${minimo||0}) ON CONFLICT (producto) DO NOTHING`;
      return ok({ done: true });
    }
    if (/^\/inventario\/\d+$/.test(path) && method === "PUT") {
      const id = parseInt(path.split("/")[2]);
      const { producto, stock, minimo, movs } = body;
      await sql`UPDATE inventario SET producto=${producto},stock=${stock||0},minimo=${minimo||0},movs=${JSON.stringify(movs||[])} WHERE id=${id}`;
      return ok({ done: true });
    }
    if (/^\/inventario\/\d+$/.test(path) && method === "DELETE") {
      const id = parseInt(path.split("/")[2]);
      await sql`DELETE FROM inventario WHERE id=${id}`;
      return ok({ done: true });
    }

    // ── TURNOS ──
    if (path === "/turnos" && method === "GET") {
      if (qs.activo) return ok(await sql`SELECT * FROM turnos WHERE estado='abierto' ORDER BY id DESC LIMIT 1`);
      if (qs.fecha) return ok(await sql`SELECT * FROM turnos WHERE fecha=${qs.fecha} ORDER BY id DESC`);
      return ok(await sql`SELECT * FROM turnos ORDER BY id DESC LIMIT 50`);
    }
    if (path === "/turnos" && method === "POST") {
      const { fecha, nombre, cajero, cajero_email, caja_inicial, abierto_en } = body;
      const r = await sql`INSERT INTO turnos (fecha,nombre,cajero,cajero_email,caja_inicial,abierto_en) VALUES (${fecha},${nombre||"Turno"},${cajero||""},${cajero_email||""},${caja_inicial||0},${abierto_en||""}) RETURNING *`;
      await logActividad(sql, fecha, abierto_en||"", cajero||"", cajero_email||"", "turno_abierto", "Caja inicial: " + (caja_inicial||0));
      return ok(r[0]);
    }
    if (/^\/turnos\/\d+$/.test(path) && method === "PUT") {
      const id = parseInt(path.split("/")[2]);
      const { caja_final, cerrado_en, estado, notas } = body;
      await sql`UPDATE turnos SET caja_final=${caja_final||0},cerrado_en=${cerrado_en||null},estado=${estado||"cerrado"},notas=${notas||null} WHERE id=${id}`;
      return ok({ done: true });
    }

    // ── GASTOS ──
    if (path === "/gastos" && method === "GET") {
      if (qs.fecha) return ok(await sql`SELECT * FROM gastos WHERE fecha=${qs.fecha} ORDER BY created_at DESC`);
      if (qs.desde && qs.hasta) return ok(await sql`SELECT * FROM gastos WHERE fecha >= ${qs.desde} AND fecha <= ${qs.hasta} ORDER BY fecha DESC`);
      return ok(await sql`SELECT * FROM gastos ORDER BY created_at DESC LIMIT 200`);
    }
    if (path === "/gastos" && method === "POST") {
      const { fecha, hora, categoria, descripcion, monto, cajero, turno_id } = body;
      const r = await sql`INSERT INTO gastos (fecha,hora,categoria,descripcion,monto,cajero,turno_id) VALUES (${fecha},${hora||null},${categoria||"General"},${descripcion||""},${monto||0},${cajero||null},${turno_id||null}) RETURNING id`;
      return ok(r[0]);
    }
    if (/^\/gastos\/\d+$/.test(path) && method === "DELETE") {
      const id = parseInt(path.split("/")[2]);
      await sql`DELETE FROM gastos WHERE id=${id}`;
      return ok({ done: true });
    }

    // ── FIADOS ──
    if (path === "/fiados" && method === "GET") {
      if (qs.estado) return ok(await sql`SELECT * FROM fiados WHERE estado=${qs.estado} ORDER BY created_at DESC`);
      return ok(await sql`SELECT * FROM fiados ORDER BY created_at DESC LIMIT 200`);
    }
    if (path === "/fiados" && method === "POST") {
      const { fecha, hora, cliente, monto, descripcion, cajero, mesa } = body;
      const r = await sql`INSERT INTO fiados (fecha,hora,cliente,monto,descripcion,cajero,mesa) VALUES (${fecha},${hora||null},${cliente},${monto||0},${descripcion||""},${cajero||null},${mesa||null}) RETURNING id`;
      return ok(r[0]);
    }
    if (/^\/fiados\/\d+$/.test(path) && method === "PUT") {
      const id = parseInt(path.split("/")[2]);
      const { estado, fecha_pago } = body;
      await sql`UPDATE fiados SET estado=${estado||"pendiente"},fecha_pago=${fecha_pago||null} WHERE id=${id}`;
      return ok({ done: true });
    }
    if (/^\/fiados\/\d+$/.test(path) && method === "DELETE") {
      const id = parseInt(path.split("/")[2]);
      await sql`DELETE FROM fiados WHERE id=${id}`;
      return ok({ done: true });
    }

    // ── RESERVAS ──
    if (path === "/reservas" && method === "GET") {
      if (qs.fecha) return ok(await sql`SELECT * FROM reservas WHERE fecha=${qs.fecha} ORDER BY hora ASC`);
      return ok(await sql`SELECT * FROM reservas ORDER BY fecha DESC, hora ASC LIMIT 100`);
    }
    if (path === "/reservas" && method === "POST") {
      const { fecha, hora, nombre, telefono, personas, mesa, notas } = body;
      const r = await sql`INSERT INTO reservas (fecha,hora,nombre,telefono,personas,mesa,notas) VALUES (${fecha},${hora||""},${nombre},${telefono||""},${personas||1},${mesa||null},${notas||""}) RETURNING id`;
      return ok(r[0]);
    }
    if (/^\/reservas\/\d+$/.test(path) && method === "PUT") {
      const id = parseInt(path.split("/")[2]);
      const { estado, mesa, notas } = body;
      await sql`UPDATE reservas SET estado=${estado||"pendiente"},mesa=${mesa||null},notas=${notas||""} WHERE id=${id}`;
      return ok({ done: true });
    }
    if (/^\/reservas\/\d+$/.test(path) && method === "DELETE") {
      const id = parseInt(path.split("/")[2]);
      await sql`DELETE FROM reservas WHERE id=${id}`;
      return ok({ done: true });
    }

    // ── EVENTOS ──
    if (path === "/eventos" && method === "GET") {
      if (qs.fecha) return ok(await sql`SELECT * FROM eventos WHERE fecha=${qs.fecha}`);
      return ok(await sql`SELECT * FROM eventos ORDER BY fecha DESC LIMIT 50`);
    }
    if (path === "/eventos" && method === "POST") {
      const { fecha, nombre, descripcion, cover } = body;
      const r = await sql`INSERT INTO eventos (fecha,nombre,descripcion,cover) VALUES (${fecha},${nombre},${descripcion||""},${cover||0}) RETURNING id`;
      return ok(r[0]);
    }
    if (/^\/eventos\/\d+$/.test(path) && method === "PUT") {
      const id = parseInt(path.split("/")[2]);
      const { nombre, descripcion, cover, activo } = body;
      await sql`UPDATE eventos SET nombre=${nombre},descripcion=${descripcion||""},cover=${cover||0},activo=${activo!==false} WHERE id=${id}`;
      return ok({ done: true });
    }
    if (/^\/eventos\/\d+$/.test(path) && method === "DELETE") {
      const id = parseInt(path.split("/")[2]);
      await sql`DELETE FROM eventos WHERE id=${id}`;
      return ok({ done: true });
    }

    // ── LOG ACTIVIDAD ──
    if (path === "/log" && method === "GET") {
      if (qs.fecha) return ok(await sql`SELECT * FROM log_actividad WHERE fecha=${qs.fecha} ORDER BY created_at DESC`);
      return ok(await sql`SELECT * FROM log_actividad ORDER BY created_at DESC LIMIT 200`);
    }

    // ── USUARIOS ──
    if (path === "/usuarios" && method === "GET") {
      return ok(await sql`SELECT * FROM usuarios ORDER BY nombre`);
    }
    if (path === "/usuarios" && method === "POST") {
      const { email, nombre, rol, foto } = body;
      await sql`INSERT INTO usuarios (email,nombre,rol,foto) VALUES (${email},${nombre},${rol},${foto||""}) ON CONFLICT (email) DO UPDATE SET nombre=EXCLUDED.nombre, rol=EXCLUDED.rol, foto=EXCLUDED.foto`;
      return ok({ done: true });
    }
    if (/^\/usuarios\/.+$/.test(path) && method === "DELETE") {
      const email = decodeURIComponent(path.split("/").slice(2).join("/"));
      await sql`DELETE FROM usuarios WHERE email=${email}`;
      return ok({ done: true });
    }

    // ── CONFIG ──
    if (path === "/config" && method === "GET") {
      const rows = await sql`SELECT * FROM config`;
      const result = {};
      rows.forEach(r => { result[r.key] = r.value; });
      return ok(result);
    }
    if (path === "/config" && method === "POST") {
      const { key, value } = body;
      await sql`INSERT INTO config (key,value) VALUES (${key},${JSON.stringify(value)}) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;
      return ok({ done: true });
    }

    // ── ANALYTICS ──
    if (path === "/analytics/resumen" && method === "GET") {
      const { desde, hasta } = qs;
      if (!desde || !hasta) return err("Faltan parámetros desde/hasta", 400);
      const ventas = await sql`SELECT fecha, SUM(total) as total, COUNT(*) as transacciones FROM ventas WHERE fecha >= ${desde} AND fecha <= ${hasta} GROUP BY fecha ORDER BY fecha ASC`;
      const gastos = await sql`SELECT fecha, SUM(monto) as total FROM gastos WHERE fecha >= ${desde} AND fecha <= ${hasta} GROUP BY fecha ORDER BY fecha ASC`;
      const topProds = await sql`SELECT producto, SUM(cantidad) as cant, SUM(total) as total FROM ventas WHERE fecha >= ${desde} AND fecha <= ${hasta} GROUP BY producto ORDER BY total DESC LIMIT 10`;
      const porPago = await sql`SELECT pago, SUM(total) as total FROM ventas WHERE fecha >= ${desde} AND fecha <= ${hasta} GROUP BY pago ORDER BY total DESC`;
      const porHora = await sql`SELECT SUBSTRING(hora,1,2) as h, SUM(total) as total FROM ventas WHERE fecha >= ${desde} AND fecha <= ${hasta} AND hora IS NOT NULL GROUP BY h ORDER BY h ASC`;
      return ok({ ventas, gastos, topProds, porPago, porHora });
    }

    return err("Not found", 404);
  } catch (e) {
    console.error("API Error:", e);
    return err(e.message || "Internal error", 500);
  }
};

async function logActividad(sql, fecha, hora, usuario, email, accion, detalle) {
  try {
    await sql`INSERT INTO log_actividad (fecha,hora,usuario,usuario_email,accion,detalle) VALUES (${fecha},${hora},${usuario},${email},${accion},${detalle})`;
  } catch(e) {}
}
