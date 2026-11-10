import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const databasePath = resolve(projectRoot, 'backend/data/saepvision.sqlite');
const uploadDirectory = resolve(projectRoot, 'assets/img');
const supportRoot = resolve(projectRoot, '..', 'anexos_prova', 'anexos_prova');
const sessionCookie = 'saepvision_session';
const sessionLifetime = 7 * 24 * 60 * 60;
const maxUploadBytes = 8 * 1024 * 1024;
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || '127.0.0.1';
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
};

await mkdir(resolve(projectRoot, 'backend/data'), { recursive: true });
await mkdir(uploadDirectory, { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
database.exec(await readFile(resolve(projectRoot, 'database.sql'), 'utf8'));

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [headers, ...records] = rows;
  return records.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${key}`;
}

function verifyPassword(password, stored) {
  if (stored.startsWith('scrypt$')) {
    const [, salt, keyHex] = stored.split('$');
    if (!salt || !keyHex) return false;
    const expected = Buffer.from(keyHex, 'hex');
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    return timingSafeEqual(Buffer.from(stored.toLowerCase(), 'hex'), createHash('sha256').update(password).digest());
  }
  const storedBuffer = Buffer.from(stored);
  const passwordBuffer = Buffer.from(password);
  return storedBuffer.length === passwordBuffer.length && timingSafeEqual(storedBuffer, passwordBuffer);
}

function seedDatabase(csvText) {
  const rows = parseCsv(csvText);
  const insertUser = database.prepare(`
    INSERT OR IGNORE INTO usuarios
      (id, nome, nome_usuario, email, senha, tipo_usuario, foto_perfil, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    const type = row.tipo === 'fotografo' ? 'fotografo' : 'comum';
    const avatar = `backend/api/media.php?tipo=avatar&arquivo=${encodeURIComponent(row.imagem_usuario)}`;
    insertUser.run(
      Number(row.id_usuario), row.nome, row.nome_usuario, row.email.toLowerCase(),
      hashPassword(row.senha), type, avatar, row.created_at, row.updated_at,
    );
  }

  const existing = database.prepare('SELECT COUNT(*) AS count FROM publicacoes').get().count;
  if (existing === 0) {
    const photographerIds = new Map(database.prepare("SELECT id, nome_usuario FROM usuarios WHERE tipo_usuario = 'fotografo'")
      .all().map((user) => [user.nome_usuario, user.id]));
    const insertPhoto = database.prepare(`
      INSERT OR IGNORE INTO publicacoes (id_fotografo, titulo, local_origem, caminho_imagem)
      VALUES (?, ?, ?, ?)
    `);
    for (let number = 1; number <= 9; number += 1) {
      const photographer = `fotografo_${((number - 1) % 3) + 1}`;
      insertPhoto.run(
        photographerIds.get(photographer), `Foto ${number}`, 'Local não informado',
        `backend/api/media.php?tipo=foto&arquivo=foto${number}.jpg`,
      );
    }
  }
  database.prepare('DELETE FROM sessoes WHERE expira_em <= ?').run(Math.floor(Date.now() / 1000));
}

const csvText = await readFile(resolve(projectRoot, 'backend/data/usuarios.csv'), 'utf8');
seedDatabase(csvText);

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(Object.assign(new Error('Corpo da solicitação muito grande.'), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('JSON inválido.'), { status: 400 }));
      }
    });
    request.on('error', reject);
  });
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return ['', ''];
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([key]) => key));
}

function publicUser(user) {
  if (!user) return null;
  const avatarName = basename(String(user.foto_perfil || '').split('?')[0]);
  const allowedAvatars = new Set([
    'saepVision.jpeg', 'fotografo1.jpg', 'fotografo2.jpg', 'fotografo3.jpg',
    'usuario1.jpg', 'usuario2.jpg', 'usuario3.jpg',
  ]);
  return {
    id: user.id,
    nome: user.nome,
    nome_usuario: user.nome_usuario,
    email: user.email,
    tipo_usuario: user.tipo_usuario,
    foto_perfil: allowedAvatars.has(avatarName)
      ? `backend/api/media.php?tipo=avatar&arquivo=${encodeURIComponent(avatarName)}`
      : user.foto_perfil,
  };
}

function getSessionUser(request) {
  const token = parseCookies(request.headers.cookie)[sessionCookie];
  if (!token) return null;
  const session = database.prepare(`
    SELECT u.* FROM sessoes s JOIN usuarios u ON u.id = s.id_usuario
    WHERE s.token = ? AND s.expira_em > ? LIMIT 1
  `).get(token, Math.floor(Date.now() / 1000));
  return publicUser(session);
}

function requireUser(request, response) {
  const user = getSessionUser(request);
  if (!user) {
    sendJson(response, 401, { erro: 'Autenticação necessária.' });
    return null;
  }
  return user;
}

function requirePhotographer(request, response) {
  const user = requireUser(request, response);
  if (!user) return null;
  if (user.tipo_usuario !== 'fotografo') {
    sendJson(response, 403, { erro: 'Apenas fotógrafos podem realizar esta ação.' });
    return null;
  }
  return user;
}

function mediaFile(kind, name) {
  const photos = new Set(Array.from({ length: 9 }, (_, index) => `foto${index + 1}.jpg`));
  const avatars = new Set([
    'saepVision.jpeg', 'fotografo1.jpg', 'fotografo2.jpg', 'fotografo3.jpg',
    'usuario1.jpg', 'usuario2.jpg', 'usuario3.jpg',
  ]);
  if (kind === 'foto' && photos.has(name)) return resolve(supportRoot, 'fotografias', name);
  if (kind === 'avatar' && avatars.has(name)) return resolve(supportRoot, 'imagens_usuarios', name);
  return null;
}

function imageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return ['image/jpeg', '.jpg'];
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ['image/png', '.png'];
  if (buffer.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/)) return ['image/gif', '.gif'];
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return ['image/webp', '.webp'];
  return null;
}

async function handleUpload(request, response, user) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxUploadBytes + 1024 * 1024) {
      sendJson(response, 413, { erro: 'A imagem deve ter no máximo 8 MB.' });
      return;
    }
    chunks.push(chunk);
  }

  let form;
  try {
    const body = Buffer.concat(chunks);
    const webRequest = new Request(`http://${request.headers.host}${request.url}`, {
      method: 'POST', headers: request.headers, body,
    });
    form = await webRequest.formData();
  } catch {
    sendJson(response, 400, { erro: 'Formulário de imagem inválido.' });
    return;
  }

  const title = String(form.get('titulo') || '').trim();
  const origin = String(form.get('local_origem') || '').trim();
  const file = form.get('imagem');
  if (!title || title.length > 180) {
    sendJson(response, 422, { erro: 'Informe um título válido para a imagem.' });
    return;
  }
  if (!origin || origin.length > 180) {
    sendJson(response, 422, { erro: 'Informe uma fonte de origem válida.' });
    return;
  }
  if (!file || typeof file.arrayBuffer !== 'function' || file.size === 0) {
    sendJson(response, 422, { erro: 'Nenhum arquivo escolhido' });
    return;
  }
  if (file.size > maxUploadBytes) {
    sendJson(response, 422, { erro: 'A imagem deve ter no máximo 8 MB.' });
    return;
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const detected = imageType(bytes);
  if (!detected) {
    sendJson(response, 422, { erro: 'Formato inválido. Use JPG, JPEG, PNG, GIF ou WEBP.' });
    return;
  }

  const fileName = `${randomBytes(16).toString('hex')}${detected[1]}`;
  const relativePath = `assets/img/${fileName}`;
  const absolutePath = resolve(uploadDirectory, fileName);
  await writeFile(absolutePath, bytes, { flag: 'wx' });
  try {
    const result = database.prepare(`
      INSERT INTO publicacoes (id_fotografo, titulo, local_origem, caminho_imagem)
      VALUES (?, ?, ?, ?)
    `).run(user.id, title, origin, relativePath);
    sendJson(response, 201, { ok: true, id: Number(result.lastInsertRowid), caminho_imagem: relativePath });
  } catch (error) {
    await unlink(absolutePath).catch(() => {});
    throw error;
  }
}

async function serveStatic(pathname, response) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendJson(response, 400, { erro: 'Caminho inválido.' });
    return;
  }
  const relativePath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  if (/^(backend|server\.js|package\.json|database\.sql)(\/|$)/i.test(relativePath) || relativePath.endsWith('.sqlite')) {
    sendJson(response, 404, { erro: 'Arquivo não encontrado.' });
    return;
  }
  const filePath = resolve(projectRoot, relativePath);
  const fromRoot = relative(projectRoot, filePath);
  if (fromRoot.startsWith('..') || fromRoot === '..' || fromRoot.includes(`..${sep}`)) {
    sendJson(response, 403, { erro: 'Acesso negado.' });
    return;
  }
  try {
    const content = await readFile(filePath);
    const type = mimeTypes[extname(filePath).toLowerCase()];
    if (!type) {
      sendJson(response, 404, { erro: 'Arquivo não encontrado.' });
      return;
    }
    response.writeHead(200, {
      'Cache-Control': /\.(html|css|js)$/i.test(filePath) ? 'no-cache' : 'public, max-age=3600',
      'Content-Length': content.length,
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(content);
  } catch {
    sendJson(response, 404, { erro: 'Arquivo não encontrado.' });
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = request.method || 'GET';

  if (method === 'GET' && pathname === '/backend/auth/me.php') {
    sendJson(response, 200, { usuario: getSessionUser(request) });
    return;
  }
  if (method === 'POST' && pathname === '/backend/auth/login.php') {
    const input = await readJson(request);
    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.senha || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
      sendJson(response, 422, { erro: 'E-mail inválido ou senha obrigatória.' });
      return;
    }
    const user = database.prepare('SELECT * FROM usuarios WHERE email = ? LIMIT 1').get(email);
    if (!user || !verifyPassword(password, user.senha)) {
      sendJson(response, 401, { erro: 'Usuário não encontrado ou senha incorreta.' });
      return;
    }
    if (!user.senha.startsWith('scrypt$')) {
      database.prepare('UPDATE usuarios SET senha = ? WHERE id = ?').run(hashPassword(password), user.id);
    }
    const token = randomBytes(32).toString('hex');
    const expires = Math.floor(Date.now() / 1000) + sessionLifetime;
    database.prepare('INSERT INTO sessoes (token, id_usuario, expira_em) VALUES (?, ?, ?)').run(token, user.id, expires);
    const secure = request.socket.encrypted ? '; Secure' : '';
    sendJson(response, 200, { usuario: publicUser(user) }, {
      'Set-Cookie': `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetime}${secure}`,
    });
    return;
  }
  if (method === 'POST' && pathname === '/backend/auth/register.php') {
    const input = await readJson(request);
    const name = String(input.nome || '').trim();
    const username = String(input.nome_usuario || '').trim();
    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.senha || '');
    const accountType = String(input.tipo_usuario || 'comum');
    if (name.length < 2 || name.length > 120) {
      sendJson(response, 422, { erro: 'Informe um nome válido.' });
      return;
    }
    if (!/^[\p{L}\p{N}_.-]{2,40}$/u.test(username)) {
      sendJson(response, 422, { erro: 'Nome de usuário inválido. Use de 2 a 40 letras, números, ponto, traço ou sublinhado.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
      sendJson(response, 422, { erro: 'E-mail inválido ou vazio' });
      return;
    }
    if (password.length < 8) {
      sendJson(response, 422, { erro: 'A senha deve ter pelo menos 8 caracteres.' });
      return;
    }
    if (!['comum', 'fotografo'].includes(accountType)) {
      sendJson(response, 422, { erro: 'Selecione um tipo de conta válido.' });
      return;
    }
    if (database.prepare('SELECT id FROM usuarios WHERE email = ? LIMIT 1').get(email)) {
      sendJson(response, 409, { erro: 'Este e-mail já está cadastrado.' });
      return;
    }
    if (database.prepare('SELECT id FROM usuarios WHERE lower(nome_usuario) = lower(?) LIMIT 1').get(username)) {
      sendJson(response, 409, { erro: 'Este nome de usuário já está em uso.' });
      return;
    }

    const timestamp = new Date().toISOString();
    const avatar = 'backend/api/media.php?tipo=avatar&arquivo=saepVision.jpeg';
    const inserted = database.prepare(`
      INSERT INTO usuarios (nome, nome_usuario, email, senha, tipo_usuario, foto_perfil, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, username, email, hashPassword(password), accountType, avatar, timestamp, timestamp);
    const user = database.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(inserted.lastInsertRowid));
    const token = randomBytes(32).toString('hex');
    const expires = Math.floor(Date.now() / 1000) + sessionLifetime;
    database.prepare('INSERT INTO sessoes (token, id_usuario, expira_em) VALUES (?, ?, ?)').run(token, user.id, expires);
    const secure = request.socket.encrypted ? '; Secure' : '';
    sendJson(response, 201, { usuario: publicUser(user) }, {
      'Set-Cookie': `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetime}${secure}`,
    });
    return;
  }
  if (method === 'POST' && pathname === '/backend/auth/register.php') {
    const input = await readJson(request);
    const name = String(input.nome || '').trim();
    const username = String(input.nome_usuario || '').trim();
    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.senha || '');
    const accountType = String(input.tipo_usuario || 'comum');
    if (name.length < 2 || name.length > 120) {
      sendJson(response, 422, { erro: 'Informe um nome válido.' });
      return;
    }
    if (!/^[\p{L}\p{N}_.-]{2,40}$/u.test(username)) {
      sendJson(response, 422, { erro: 'Nome de usuário inválido. Use de 2 a 40 letras, números, ponto, traço ou sublinhado.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
      sendJson(response, 422, { erro: 'E-mail inválido ou vazio' });
      return;
    }
    if (password.length < 8) {
      sendJson(response, 422, { erro: 'A senha deve ter pelo menos 8 caracteres.' });
      return;
    }
    if (!['comum', 'fotografo'].includes(accountType)) {
      sendJson(response, 422, { erro: 'Selecione um tipo de conta válido.' });
      return;
    }
    if (database.prepare('SELECT id FROM usuarios WHERE email = ? LIMIT 1').get(email)) {
      sendJson(response, 409, { erro: 'Este e-mail já está cadastrado.' });
      return;
    }
    if (database.prepare('SELECT id FROM usuarios WHERE lower(nome_usuario) = lower(?) LIMIT 1').get(username)) {
      sendJson(response, 409, { erro: 'Este nome de usuário já está em uso.' });
      return;
    }

    const timestamp = new Date().toISOString();
    const avatar = 'backend/api/media.php?tipo=avatar&arquivo=saepVision.jpeg';
    database.exec('BEGIN IMMEDIATE');
    try {
      const inserted = database.prepare(`
        INSERT INTO usuarios (nome, nome_usuario, email, senha, tipo_usuario, foto_perfil, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, username, email, hashPassword(password), accountType, avatar, timestamp, timestamp);
      const user = database.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(inserted.lastInsertRowid));
      const token = randomBytes(32).toString('hex');
      const expires = Math.floor(Date.now() / 1000) + sessionLifetime;
      database.prepare('INSERT INTO sessoes (token, id_usuario, expira_em) VALUES (?, ?, ?)').run(token, user.id, expires);
      database.exec('COMMIT');
      const secure = request.socket.encrypted ? '; Secure' : '';
      sendJson(response, 201, { usuario: publicUser(user) }, {
        'Set-Cookie': `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetime}${secure}`,
      });
    } catch (error) {
      database.exec('ROLLBACK');
      if (String(error.message).includes('UNIQUE constraint failed')) {
        sendJson(response, 409, { erro: 'E-mail ou nome de usuário já cadastrado.' });
        return;
      }
      throw error;
    }
    return;
  }
  if (method === 'POST' && pathname === '/backend/auth/logout.php') {
    const token = parseCookies(request.headers.cookie)[sessionCookie];
    if (token) database.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
    sendJson(response, 200, { ok: true }, {
      'Set-Cookie': `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    });
    return;
  }
  if (method === 'GET' && pathname === '/backend/api/health.php') {
    database.prepare('SELECT id FROM usuarios LIMIT 0').all();
    sendJson(response, 200, { ok: true, database: 'sqlite' });
    return;
  }
  if (method === 'GET' && pathname === '/backend/api/media.php') {
    const imagePath = mediaFile(url.searchParams.get('tipo') || '', basename(url.searchParams.get('arquivo') || ''));
    if (!imagePath) {
      sendJson(response, 404, { erro: 'Imagem não encontrada.' });
      return;
    }
    try {
      const content = await readFile(imagePath);
      response.writeHead(200, {
        'Cache-Control': 'public, max-age=86400',
        'Content-Length': content.length,
        'Content-Type': imagePath.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/jpeg',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(content);
    } catch {
      sendJson(response, 404, { erro: 'Imagem de apoio não encontrada. Confira a pasta anexos_prova.' });
    }
    return;
  }
  if (method === 'GET' && pathname === '/backend/api/get_publicacoes.php') {
    const user = getSessionUser(request);
    const ownOnly = url.searchParams.get('minhas') === '1';
    const search = (url.searchParams.get('fotografo') || '').trim();
    if (ownOnly && (!user || user.tipo_usuario !== 'fotografo')) {
      sendJson(response, 403, { erro: 'Acesso permitido somente ao fotógrafo autenticado.' });
      return;
    }
    if (search && !/^@?[\p{L}\p{N}_.-]{2,50}$/u.test(search)) {
      sendJson(response, 422, { erro: 'Formato inválido' });
      return;
    }
    const filters = [];
    const values = [user?.id || 0];
    if (ownOnly) {
      filters.push('p.id_fotografo = ?');
      values.push(user.id);
    }
    if (search) {
      const normalized = search.replace(/^@/, '').toLocaleLowerCase('pt-BR');
      const photographer = database.prepare(`
        SELECT id FROM usuarios WHERE tipo_usuario = 'fotografo'
          AND (lower(nome_usuario) = ? OR lower(nome) = ?) LIMIT 1
      `).get(normalized, normalized);
      if (!photographer) {
        sendJson(response, 404, { erro: 'Fotógrafo não encontrado' });
        return;
      }
      filters.push('p.id_fotografo = ?');
      values.push(photographer.id);
    }
    const query = `
      SELECT p.id, p.titulo, p.local_origem, p.caminho_imagem, p.id_fotografo,
        u.nome, u.nome_usuario, u.foto_perfil,
        COUNT(DISTINCT c.id) AS total_curtidas,
        MAX(CASE WHEN c.id_usuario = ? THEN 1 ELSE 0 END) AS curtida_pelo_usuario
      FROM publicacoes p
      JOIN usuarios u ON u.id = p.id_fotografo
      LEFT JOIN curtidas c ON c.id_publicacao = p.id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      GROUP BY p.id, u.id
      ORDER BY p.created_at DESC, p.id DESC
    `;
    sendJson(response, 200, { publicacoes: database.prepare(query).all(...values) });
    return;
  }
  if (method === 'GET' && pathname === '/backend/api/get_perfil.php') {
    const user = requirePhotographer(request, response);
    if (!user) return;
    const profile = database.prepare(`
      SELECT COUNT(DISTINCT p.id) AS total_publicacoes, COUNT(DISTINCT c.id) AS total_curtidas
      FROM usuarios u
      LEFT JOIN publicacoes p ON p.id_fotografo = u.id
      LEFT JOIN curtidas c ON c.id_publicacao = p.id
      WHERE u.id = ?
    `).get(user.id);
    sendJson(response, 200, { perfil: profile });
    return;
  }
  if (method === 'POST' && pathname === '/backend/api/curtir.php') {
    const user = requireUser(request, response);
    if (!user) return;
    const input = await readJson(request);
    const publicationId = Number(input.id_publicacao);
    if (!Number.isInteger(publicationId) || publicationId < 1) {
      sendJson(response, 422, { erro: 'Publicação inválida.' });
      return;
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      const publication = database.prepare('SELECT id FROM publicacoes WHERE id = ?').get(publicationId);
      if (!publication) {
        database.exec('ROLLBACK');
        sendJson(response, 404, { erro: 'Publicação não encontrada.' });
        return;
      }
      const existing = database.prepare('SELECT id FROM curtidas WHERE id_usuario = ? AND id_publicacao = ?').get(user.id, publicationId);
      const liked = !existing;
      if (existing) database.prepare('DELETE FROM curtidas WHERE id = ?').run(existing.id);
      else database.prepare('INSERT INTO curtidas (id_usuario, id_publicacao) VALUES (?, ?)').run(user.id, publicationId);
      const total = database.prepare('SELECT COUNT(*) AS count FROM curtidas WHERE id_publicacao = ?').get(publicationId).count;
      database.exec('COMMIT');
      sendJson(response, 200, { curtido: liked, total_curtidas: total });
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return;
  }
  if (method === 'POST' && pathname === '/backend/api/cadastrar_foto.php') {
    const user = requirePhotographer(request, response);
    if (!user) return;
    await handleUpload(request, response, user);
    return;
  }
  if (method === 'POST' && pathname === '/backend/api/deletar_foto.php') {
    const user = requirePhotographer(request, response);
    if (!user) return;
    const input = await readJson(request);
    const publicationId = Number(input.id_publicacao);
    if (!Number.isInteger(publicationId) || publicationId < 1) {
      sendJson(response, 422, { erro: 'Publicação inválida.' });
      return;
    }
    const publication = database.prepare('SELECT caminho_imagem FROM publicacoes WHERE id = ? AND id_fotografo = ?').get(publicationId, user.id);
    if (!publication) {
      sendJson(response, 404, { erro: 'Publicação não encontrada ou sem permissão para excluí-la.' });
      return;
    }
    database.prepare('DELETE FROM publicacoes WHERE id = ? AND id_fotografo = ?').run(publicationId, user.id);
    if (publication.caminho_imagem.startsWith('assets/img/')) {
      const imagePath = resolve(projectRoot, publication.caminho_imagem);
      const fromUploads = relative(uploadDirectory, imagePath);
      if (!fromUploads.startsWith('..') && fromUploads !== '..') await unlink(imagePath).catch(() => {});
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname.startsWith('/backend/')) {
    sendJson(response, 404, { erro: 'Endpoint não encontrado.' });
    return;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(response, 405, { erro: 'Método não permitido.' });
    return;
  }
  await serveStatic(pathname, response);
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, error.status || 500, { erro: error.status ? error.message : 'Erro interno do servidor.' });
    } else {
      response.destroy();
    }
  });
});

server.listen(port, host, () => {
  console.log(`SAEPVision SQLite disponível em http://${host}:${port}/`);
  console.log(`Banco local: ${databasePath}`);
  console.log('Contas do CSV foram carregadas quando ausentes. Para testar fotógrafo: fotografo1@email.com / 123456');
});
