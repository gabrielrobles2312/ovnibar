const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.NETLIFY_DATABASE_URL);

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

function ok(data) {
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data) };
}
function err(msg, code) {
  return { statusCode: code || 500, headers: HEADERS, body: JSON.stringify({ error: msg }) };
}

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
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS carta (
    id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, categoria TEXT,
    precio INT, emoji TEXT, activo BOOLEAN DEFAULT true
  )`;
  await sql`CREATE TABLE IF NOT EXISTS inventario (
    id SERIAL PRIMARY KEY, producto TEXT UNIQUE NOT NULL,
    stock INT DEFAULT 0, minimo INT DEFAULT 0, movs JSONB DEFAULT '[]'
  )`;
  await sql`CREATE TABLE IF NOT EXISTS usuarios (
    email TEXT PRIMARY KEY, nombre TEXT, rol TEXT, foto TEXT
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
      ["Agua","🥤 Sin alcohol",3000,"🥤"],["Coca Cola","🥤 Sin alcohol",5000,"🥤"],
    ];
    for (const [nombre, categoria, precio, emoji] of items) {
      await sql`INSERT INTO carta (nombre,categoria,precio,emoji) VALUES (${nombre},${categoria},${precio},${emoji})`;
    }
  }

  const [{ c: ic }] = await sql`SELECT COUNT(*) as c FROM inventario`;
  if (parseInt(ic) === 0) {
    const items = [
      ["Corona",24,6],["Aguila",12,6],["Poker",18,6],["Andina",10,4],
      ["Red Bull",8,4],["Gatorade",12,4],["Agua",20,6],["Coca Cola",10,4],
      ["Smirnoff Botella",3,2],["Ron Botella",4,2],["Ron Litro",2,1],
      ["Botella Azul",3,1],["Botella Amarillo",2,1],
    ];
    for (const [producto, stock, minimo] of items) {
      await sql`INSERT INTO inventario (producto,stock,minimo) VALUES (${producto},${stock},${minimo})`;
    }
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});

  try {
    await initDB();

    const raw = event.path || "";
    const path = raw.replace("/.netlify/functions/api", "");
    const method = event.httpMethod;
    const body = event.body ? JSON.parse(event.body) : {};
    const qs = event.queryStringParameters || {};

    // MESAS
    if (path === "/mesas" && method === "GET") {
      const rows = await sql`SELECT * FROM mesas ORDER BY num`;
      return ok(rows);
    }
    if (path === "/mesas" && method === "POST") {
      const { num } = body;
      await sql`INSERT INTO mesas (num) VALUES (${num}) ON CONFLICT DO NOTHING`;
      return ok({ done: true });
    }
    if (/^\/mesas\/\d+$/.test(path) && method === "PUT") {
      const num = parseInt(path.split("/")[2]);
      const { estado, comanda, abierta_en, mesero, mesero_email } = body;
      await sql`UPDATE mesas SET estado=${estado||"libre"}, comanda=${JSON.stringify(comanda||[])}, abierta_en=${abierta_en||null}, mesero=${mesero||null}, mesero_email=${mesero_email||null} WHERE num=${num}`;
      return ok({ done: true });
    }

    // VENTAS
    if (path === "/ventas" && method === "GET") {
      const rows = qs.fecha
        ? await sql`SELECT * FROM ventas WHERE fecha=${qs.fecha} ORDER BY created_at ASC`
        : await sql`SELECT * FROM ventas ORDER BY created_at DESC LIMIT 500`;
      return ok(rows);
    }
    if (path === "/ventas" && method === "POST") {
      const { fecha, hora, mesa, producto, cantidad, precio, total, pago, cajero, cajero_email, comp } = body;
      const r = await sql`INSERT INTO ventas (fecha,hora,mesa,producto,cantidad,precio,total,pago,cajero,cajero_email,comp) VALUES (${fecha},${hora||null},${mesa||null},${producto},${cantidad||1},${precio||0},${total||0},${pago},${cajero||null},${cajero_email||null},${comp||null}) RETURNING id`;
      return ok(r[0]);
    }
    if (/^\/ventas\/\d+$/.test(path) && method === "DELETE") {
      const id = parseInt(path.split("/")[2]);
      await sql`DELETE FROM ventas WHERE id=${id}`;
      return ok({ done: true });
    }

    // CARTA
    if (path === "/carta" && method === "GET") {
      const rows = await sql`SELECT * FROM carta WHERE activo=true ORDER BY categoria, nombre`;
      return ok(rows);
    }
    if (path === "/carta" && method === "POST") {
      const { nombre, categoria, precio, emoji } = body;
      const r = await sql`INSERT INTO carta (nombre,categoria,precio,emoji) VALUES (${nombre},${categoria||"⭐ Especiales"},${precio||0},${emoji||"🍹"}) RETURNING *`;
      return ok(r[0]);
    }
    if (/^\/carta\/\d+$/.test(path) && method === "PUT") {
      const id = parseInt(path.split("/")[2]);
      const { nombre, categoria, precio, emoji } = body;
      await sql`UPDATE carta SET nombre=${nombre},categoria=${categoria},precio=${precio||0},emoji=${emoji||"🍹"} WHERE id=${id}`;
      return ok({ done: true });
    }
    if (/^\/carta\/\d+$/.test(path) && method === "DELETE") {
      const id = parseInt(path.split("/")[2]);
      await sql`UPDATE carta SET activo=false WHERE id=${id}`;
      return ok({ done: true });
    }

    // INVENTARIO
    if (path === "/inventario" && method === "GET") {
      const rows = await sql`SELECT * FROM inventario ORDER BY producto`;
      return ok(rows);
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

    // USUARIOS
    if (path === "/usuarios" && method === "GET") {
      const rows = await sql`SELECT * FROM usuarios ORDER BY nombre`;
      return ok(rows);
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

    // CONFIG
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

    return err("Not found", 404);
  } catch (e) {
    console.error("API Error:", e);
    return err(e.message || "Internal error", 500);
  }
};
