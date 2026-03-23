// netlify/functions/api.js
const { neon } = require("@neondatabase/serverless");

const H = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
};
const ok  = d => ({ statusCode: 200, headers: H, body: JSON.stringify(d) });
const err = (m, c) => ({ statusCode: c||500, headers: H, body: JSON.stringify({ error: m }) });

async function initDB(sql) {
  await sql`CREATE TABLE IF NOT EXISTS usuarios (
    email  TEXT PRIMARY KEY,
    nombre TEXT, rol TEXT DEFAULT 'cajero', foto TEXT
  )`;

  await sql`CREATE TABLE IF NOT EXISTS productos (
    id            SERIAL PRIMARY KEY,
    nombre        TEXT NOT NULL,
    categoria     TEXT,
    precio        INT  DEFAULT 0,
    emoji         TEXT DEFAULT '🍹',
    activo        BOOLEAN DEFAULT true,
    inv_item_id   INT  DEFAULT NULL,
    inv_descuento NUMERIC(6,2) DEFAULT 1
  )`;

  await sql`CREATE TABLE IF NOT EXISTS inventario (
    id      SERIAL PRIMARY KEY,
    nombre  TEXT UNIQUE NOT NULL,
    stock   NUMERIC(10,2) DEFAULT 0,
    minimo  NUMERIC(10,2) DEFAULT 0,
    movs    JSONB DEFAULT '[]'
  )`;

  await sql`CREATE TABLE IF NOT EXISTS ventas (
    id          SERIAL PRIMARY KEY,
    fecha       TEXT NOT NULL,
    hora        TEXT,
    descripcion TEXT,
    total       INT  DEFAULT 0,
    metodo      TEXT DEFAULT 'Efectivo',
    tipo        TEXT DEFAULT 'libre',
    items       JSONB DEFAULT '[]',
    turno_nom   TEXT,
    cajero      TEXT,
    desc_pct    INT  DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS gastos (
    id          SERIAL PRIMARY KEY,
    fecha       TEXT NOT NULL,
    hora        TEXT,
    categoria   TEXT,
    descripcion TEXT,
    monto       INT  DEFAULT 0,
    cajero      TEXT,
    recurrente  BOOLEAN DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS turnos (
    id           SERIAL PRIMARY KEY,
    nombre       TEXT NOT NULL,
    cajero       TEXT,
    caja_inicial INT  DEFAULT 0,
    fecha        TEXT NOT NULL,
    abierto_en   TEXT,
    cerrado_en   TEXT,
    estado       TEXT DEFAULT 'abierto',
    created_at   TIMESTAMPTZ DEFAULT NOW()
  )`;

  // Seeds
  const [{ c: cp }] = await sql`SELECT COUNT(*) AS c FROM productos`;
  if (parseInt(cp) === 0) {
    const seed = [
      ["Corona","🍺 Cervezas",150,"🍺"],["Presidente","🍺 Cervezas",150,"🍺"],
      ["Heineken","🍺 Cervezas",180,"🍺"],["Botella Ron","🥃 Licores",600,"🥃"],
      ["Trago de Ron","🥃 Licores",150,"🥃"],["Botella Brugal","🥃 Licores",550,"🥃"],
      ["Trago de Brugal","🥃 Licores",120,"🥃"],["Mojito","🍹 Cócteles",250,"🍹"],
      ["Cuba Libre","🍹 Cócteles",220,"🍹"],["Jugo","🥤 Sin alcohol",100,"🥤"],
      ["Agua","🥤 Sin alcohol",50,"💧"],["Coca Cola","🥤 Sin alcohol",100,"🥤"],
    ];
    for (const [n,c,p,e] of seed)
      await sql`INSERT INTO productos (nombre,categoria,precio,emoji) VALUES (${n},${c},${p},${e})`;
  }
  const [{ c: ci }] = await sql`SELECT COUNT(*) AS c FROM inventario`;
  if (parseInt(ci) === 0) {
    const inv = [["Corona",24,6],["Presidente",24,6],["Heineken",12,6],
      ["Ron Barceló",4,2],["Brugal",3,2],["Agua",20,6],["Coca Cola",10,4]];
    for (const [n,s,m] of inv)
      await sql`INSERT INTO inventario (nombre,stock,minimo) VALUES (${n},${s},${m})`;
  }
}

async function descontarInventario(sql, items, cajero, fecha, hora) {
  const avisos = [];
  for (const item of (items||[])) {
    if (!item.inv_item_id || Number(item.inv_descuento) === 0) continue;
    const desc = Number(item.inv_descuento) * Number(item.cant||1);
    const [inv] = await sql`SELECT * FROM inventario WHERE id=${item.inv_item_id}`;
    if (!inv) continue;
    const nuevoStock = Math.max(0, Number(inv.stock) - desc);
    const movs = Array.isArray(inv.movs) ? inv.movs : JSON.parse(inv.movs||"[]");
    movs.push({ tipo:"salida", cant:desc, nota:`Venta: ${item.nom}`, hora:hora||"", fecha:fecha||"", usuario:cajero||"sistema" });
    await sql`UPDATE inventario SET stock=${nuevoStock}, movs=${JSON.stringify(movs)} WHERE id=${inv.id}`;
    if (nuevoStock < Number(inv.minimo))
      avisos.push(`⚠️ ${inv.nombre}: stock bajo (${nuevoStock} restantes)`);
  }
  return avisos;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (!process.env.NETLIFY_DATABASE_URL) return err("NETLIFY_DATABASE_URL no configurada", 500);
  let sql;
  try { sql = neon(process.env.NETLIFY_DATABASE_URL); } catch(e) { return err("Conexión fallida: "+e.message, 500); }

  try {
    await initDB(sql);
    const path   = (event.path||"").replace("/.netlify/functions/api","");
    const method = event.httpMethod;
    const qs     = event.queryStringParameters||{};
    let body = {};
    if (event.body) try { body = JSON.parse(event.body); } catch(e) { return err("Body inválido",400); }

    // ── USUARIOS ────────────────────────────────────────
    if (path==="/usuarios" && method==="GET")
      return ok(await sql`SELECT * FROM usuarios ORDER BY nombre`);
    if (path==="/usuarios" && method==="POST") {
      const { email, nombre, rol, foto } = body;
      if (!email) return err("email requerido",400);
      await sql`INSERT INTO usuarios (email,nombre,rol,foto) VALUES (${email},${nombre||""},${rol||"cajero"},${foto||""})
        ON CONFLICT (email) DO UPDATE SET nombre=EXCLUDED.nombre, rol=EXCLUDED.rol, foto=EXCLUDED.foto`;
      return ok({ done:true });
    }
    if (/^\/usuarios\/.+$/.test(path) && method==="PUT") {
      const email = decodeURIComponent(path.split("/").slice(2).join("/"));
      await sql`UPDATE usuarios SET nombre=${body.nombre}, rol=${body.rol} WHERE email=${email}`;
      return ok({ done:true });
    }
    if (/^\/usuarios\/.+$/.test(path) && method==="DELETE") {
      await sql`DELETE FROM usuarios WHERE email=${decodeURIComponent(path.split("/").slice(2).join("/"))}`;
      return ok({ done:true });
    }

    // ── PRODUCTOS ───────────────────────────────────────
    if (path==="/productos" && method==="GET") {
      return ok(await sql`SELECT p.*, i.nombre AS inv_nombre, i.stock AS inv_stock
        FROM productos p LEFT JOIN inventario i ON p.inv_item_id=i.id
        WHERE p.activo=true ORDER BY p.categoria, p.nombre`);
    }
    if (path==="/productos" && method==="POST") {
      const { nombre, categoria, precio, emoji, inv_item_id, inv_descuento } = body;
      if (!nombre||!precio) return err("nombre y precio requeridos",400);
      const r = await sql`INSERT INTO productos (nombre,categoria,precio,emoji,inv_item_id,inv_descuento)
        VALUES (${nombre},${categoria||"⭐ Especiales"},${Number(precio)},${emoji||"🍹"},
          ${inv_item_id||null},${Number(inv_descuento)||1}) RETURNING *`;
      return ok(r[0]);
    }
    if (/^\/productos\/\d+$/.test(path) && method==="PUT") {
      const id = parseInt(path.split("/")[2]);
      const { nombre, categoria, precio, emoji, inv_item_id, inv_descuento } = body;
      await sql`UPDATE productos SET nombre=${nombre},categoria=${categoria},precio=${Number(precio)},
        emoji=${emoji||"🍹"},inv_item_id=${inv_item_id||null},inv_descuento=${Number(inv_descuento)||1} WHERE id=${id}`;
      return ok({ done:true });
    }
    if (/^\/productos\/\d+$/.test(path) && method==="DELETE") {
      await sql`UPDATE productos SET activo=false WHERE id=${parseInt(path.split("/")[2])}`;
      return ok({ done:true });
    }

    // ── INVENTARIO ──────────────────────────────────────
    if (path==="/inventario" && method==="GET")
      return ok(await sql`SELECT * FROM inventario ORDER BY nombre`);
    if (path==="/inventario" && method==="POST") {
      const { nombre, stock, minimo } = body;
      if (!nombre) return err("nombre requerido",400);
      await sql`INSERT INTO inventario (nombre,stock,minimo) VALUES (${nombre},${Number(stock)||0},${Number(minimo)||0}) ON CONFLICT (nombre) DO NOTHING`;
      return ok({ done:true });
    }
    if (/^\/inventario\/\d+$/.test(path) && method==="PUT") {
      const id = parseInt(path.split("/")[2]);
      const { nombre, stock, minimo, movs } = body;
      await sql`UPDATE inventario SET nombre=${nombre},stock=${Number(stock)||0},minimo=${Number(minimo)||0},movs=${JSON.stringify(movs||[])} WHERE id=${id}`;
      return ok({ done:true });
    }
    if (/^\/inventario\/\d+$/.test(path) && method==="DELETE") {
      await sql`DELETE FROM inventario WHERE id=${parseInt(path.split("/")[2])}`;
      return ok({ done:true });
    }

    // ── VENTAS ──────────────────────────────────────────
    if (path==="/ventas" && method==="GET") {
      if (qs.fecha) return ok(await sql`SELECT * FROM ventas WHERE fecha=${qs.fecha} ORDER BY created_at ASC`);
      if (qs.desde && qs.hasta) return ok(await sql`SELECT * FROM ventas WHERE fecha>=${qs.desde} AND fecha<=${qs.hasta} ORDER BY fecha ASC,created_at ASC`);
      return ok(await sql`SELECT * FROM ventas ORDER BY created_at DESC LIMIT 1000`);
    }
    if (path==="/ventas" && method==="POST") {
      const { fecha, hora, descripcion, total, metodo, tipo, items, turno_nom, cajero, desc_pct } = body;
      if (!fecha||total===undefined) return err("fecha y total requeridos",400);
      const r = await sql`INSERT INTO ventas (fecha,hora,descripcion,total,metodo,tipo,items,turno_nom,cajero,desc_pct)
        VALUES (${fecha},${hora||null},${descripcion||""},${Number(total)},${metodo||"Efectivo"},
          ${tipo||"libre"},${JSON.stringify(items||[])},${turno_nom||null},${cajero||null},${Number(desc_pct)||0}) RETURNING id`;
      const avisos = items&&items.length ? await descontarInventario(sql,items,cajero,fecha,hora) : [];
      return ok({ id:r[0].id, avisos });
    }
    if (/^\/ventas\/\d+$/.test(path) && method==="DELETE") {
      await sql`DELETE FROM ventas WHERE id=${parseInt(path.split("/")[2])}`;
      return ok({ done:true });
    }

    // ── GASTOS ──────────────────────────────────────────
    if (path==="/gastos" && method==="GET") {
      if (qs.fecha) return ok(await sql`SELECT * FROM gastos WHERE fecha=${qs.fecha} ORDER BY created_at DESC`);
      if (qs.desde && qs.hasta) return ok(await sql`SELECT * FROM gastos WHERE fecha>=${qs.desde} AND fecha<=${qs.hasta} ORDER BY fecha DESC,created_at DESC`);
      return ok(await sql`SELECT * FROM gastos ORDER BY created_at DESC LIMIT 500`);
    }
    if (path==="/gastos" && method==="POST") {
      const { fecha, hora, categoria, descripcion, monto, cajero, recurrente } = body;
      if (!fecha||!monto) return err("fecha y monto requeridos",400);
      const r = await sql`INSERT INTO gastos (fecha,hora,categoria,descripcion,monto,cajero,recurrente)
        VALUES (${fecha},${hora||null},${categoria||"General"},${descripcion||""},${Number(monto)},${cajero||null},${recurrente||false}) RETURNING id`;
      return ok(r[0]);
    }
    if (/^\/gastos\/\d+$/.test(path) && method==="DELETE") {
      await sql`DELETE FROM gastos WHERE id=${parseInt(path.split("/")[2])}`;
      return ok({ done:true });
    }

    // ── TURNOS ──────────────────────────────────────────
    if (path==="/turnos" && method==="GET") {
      if (qs.activo) return ok(await sql`SELECT * FROM turnos WHERE estado='abierto' ORDER BY id DESC LIMIT 1`);
      return ok(await sql`SELECT * FROM turnos ORDER BY id DESC LIMIT 50`);
    }
    if (path==="/turnos" && method==="POST") {
      const { nombre, cajero, caja_inicial, fecha, abierto_en } = body;
      if (!nombre||!fecha) return err("nombre y fecha requeridos",400);
      const r = await sql`INSERT INTO turnos (nombre,cajero,caja_inicial,fecha,abierto_en)
        VALUES (${nombre},${cajero||""},${Number(caja_inicial)||0},${fecha},${abierto_en||""}) RETURNING *`;
      return ok(r[0]);
    }
    if (/^\/turnos\/\d+$/.test(path) && method==="PUT") {
      const id = parseInt(path.split("/")[2]);
      await sql`UPDATE turnos SET estado=${body.estado||"cerrado"},cerrado_en=${body.cerrado_en||null} WHERE id=${id}`;
      return ok({ done:true });
    }

    // ── RESUMEN (para conciliación y acumulado) ─────────
    if (path==="/resumen" && method==="GET") {
      const desde = qs.desde, hasta = qs.hasta;
      if (!desde||!hasta) return err("desde y hasta requeridos",400);
      const ventas  = await sql`SELECT fecha, SUM(total) AS tv, COUNT(*) AS n FROM ventas WHERE fecha>=${desde} AND fecha<=${hasta} GROUP BY fecha ORDER BY fecha ASC`;
      const gastos  = await sql`SELECT fecha, SUM(monto) AS tg, COUNT(*) AS n FROM gastos WHERE fecha>=${desde} AND fecha<=${hasta} GROUP BY fecha ORDER BY fecha ASC`;
      const porMet  = await sql`SELECT metodo, SUM(total) AS tv FROM ventas WHERE fecha>=${desde} AND fecha<=${hasta} GROUP BY metodo ORDER BY tv DESC`;
      const porCat  = await sql`SELECT categoria, SUM(monto) AS tg FROM gastos WHERE fecha>=${desde} AND fecha<=${hasta} GROUP BY categoria ORDER BY tg DESC`;
      const totVent = ventas.reduce((s,v)=>s+Number(v.tv),0);
      const totGast = gastos.reduce((s,g)=>s+Number(g.tg),0);
      return ok({ ventas, gastos, porMet, porCat, totVent, totGast, ganancia:totVent-totGast });
    }

    return err("Ruta no encontrada: "+method+" "+path, 404);
  } catch(e) {
    console.error("API Error:", e.message);
    return err("Error interno: "+e.message, 500);
  }
};
